// Plaid transaction sync engine.
//
// Uses Plaid's cursor-based /transactions/sync so only new/modified/removed
// transactions are fetched after the first run. Designed to be called from an
// API route so it runs entirely server-side (access tokens never touch
// the browser).

import { plaidClient } from "./plaid";
import { prisma } from "./prisma";
import { parseISODay } from "./dates";
import type { TxnType } from "@/generated/prisma/enums";

// ── Plaid account type → our AccountType ─────────────────────────────────────

// ── Plaid category → our default-category name (best-effort) ─────────────────

const CATEGORY_MAP: Record<string, string> = {
  INCOME: "Salary",
  INCOME_DIVIDENDS: "Investment Income",
  INCOME_INTEREST_EARNED: "Interest",
  INCOME_RETIREMENT_PENSION: "Salary",
  INCOME_TAX_REFUND: "Refund",
  INCOME_WAGES: "Salary",
  TRANSFER_IN: "Other Income",
  LOAN_PAYMENTS: "Debt Payment",
  LOAN_PAYMENTS_CAR_PAYMENT: "Debt Payment",
  LOAN_PAYMENTS_STUDENT_LOAN_PAYMENT: "Education",
  BANK_FEES: "Fees",
  ENTERTAINMENT: "Entertainment",
  ENTERTAINMENT_MUSIC_AND_AUDIO: "Subscriptions",
  ENTERTAINMENT_SPORTING_EVENTS: "Entertainment",
  ENTERTAINMENT_TV_AND_MOVIES: "Subscriptions",
  ENTERTAINMENT_VIDEO_GAMES: "Entertainment",
  FOOD_AND_DRINK: "Dining Out",
  FOOD_AND_DRINK_COFFEE: "Dining Out",
  FOOD_AND_DRINK_GROCERIES: "Groceries",
  FOOD_AND_DRINK_RESTAURANT: "Dining Out",
  GENERAL_MERCHANDISE: "Shopping",
  GENERAL_MERCHANDISE_ONLINE_MARKETPLACES: "Shopping",
  GENERAL_MERCHANDISE_SUPERSTORES: "Groceries",
  GENERAL_SERVICES: "Other Expense",
  HOME_IMPROVEMENT: "Home Maintenance",
  MEDICAL: "Health",
  MEDICAL_PHARMACIES: "Health",
  PERSONAL_CARE: "Personal Care",
  RENT_AND_UTILITIES: "Utilities",
  RENT_AND_UTILITIES_GAS_AND_ELECTRICITY: "Utilities",
  RENT_AND_UTILITIES_INTERNET_AND_CABLE: "Internet / Phone",
  RENT_AND_UTILITIES_RENT: "Rent / Mortgage",
  RENT_AND_UTILITIES_TELEPHONE: "Internet / Phone",
  RENT_AND_UTILITIES_WATER: "Utilities",
  TRANSPORTATION: "Transportation",
  TRANSPORTATION_FUEL: "Gas / Fuel",
  TRANSPORTATION_PARKING: "Transportation",
  TRANSPORTATION_TOLLS: "Transportation",
  TRAVEL: "Travel",
  TRAVEL_FLIGHTS: "Travel",
  TRAVEL_LODGING: "Travel",
};

function plaidCategoryToName(primaryCategory: string, detailCategory?: string): string | null {
  if (detailCategory) {
    const key = `${primaryCategory}_${detailCategory.replace(/ /g, "_").toUpperCase()}`;
    if (CATEGORY_MAP[key]) return CATEGORY_MAP[key];
  }
  return CATEGORY_MAP[primaryCategory] ?? null;
}

// ── Main sync function ────────────────────────────────────────────────────────

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  balancesUpdated: number;
}

export async function syncPlaidItem(plaidItemId: string): Promise<SyncResult> {
  const item = await prisma.plaidItem.findUniqueOrThrow({
    where: { id: plaidItemId },
    include: {
      linkedAccounts: {
        include: { financialAccount: true },
      },
    },
  });

  // Build a map from plaidAccountId → our linked account row.
  const linkedByPlaidId = new Map(item.linkedAccounts.map((a) => [a.plaidAccountId, a]));

  // Load the household's categories once so we can resolve names → ids.
  const categories = await prisma.category.findMany({ where: { householdId: item.householdId } });
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

  const result: SyncResult = { added: 0, modified: 0, removed: 0, balancesUpdated: 0 };

  // ── Paginated transaction sync ──────────────────────────────────────────────
  let cursor = item.cursor ?? undefined;
  let hasMore = true;

  while (hasMore) {
    const syncResponse = await plaidClient.transactionsSync({
      access_token: item.accessToken,
      cursor,
      count: 500,
    });
    const data = syncResponse.data;
    cursor = data.next_cursor;
    hasMore = data.has_more;

    // --- ADDED ---
    for (const txn of data.added) {
      if (txn.pending) continue; // only import posted transactions

      const linked = linkedByPlaidId.get(txn.account_id);
      if (!linked?.financialAccountId) continue; // account not linked to a local account yet

      // Plaid: positive amount = money out (expense), negative = money in (income).
      const isIncome = txn.amount < 0;
      const amount = Math.abs(txn.amount);
      const type: TxnType = isIncome ? "INCOME" : "EXPENSE";

      const primaryCat = txn.personal_finance_category?.primary ?? "";
      const detailCat = txn.personal_finance_category?.detailed ?? "";
      const catName = plaidCategoryToName(primaryCat, detailCat);
      const categoryId = catName ? catByName.get(catName.toLowerCase())?.id ?? null : null;

      await prisma.transaction.upsert({
        where: { plaidTransactionId: txn.transaction_id },
        update: {
          amount,
          description: txn.name,
          date: parseISODay(txn.date),
          type,
          categoryId,
          cleared: !txn.pending,
        },
        create: {
          householdId: item.householdId,
          accountId: linked.financialAccountId,
          categoryId,
          type,
          amount,
          date: parseISODay(txn.date),
          description: txn.name,
          cleared: !txn.pending,
          plaidTransactionId: txn.transaction_id,
        },
      });
      result.added++;
    }

    // --- MODIFIED ---
    for (const txn of data.modified) {
      if (txn.pending) continue;
      const linked = linkedByPlaidId.get(txn.account_id);
      if (!linked?.financialAccountId) continue;

      const isIncome = txn.amount < 0;
      const amount = Math.abs(txn.amount);
      const type: TxnType = isIncome ? "INCOME" : "EXPENSE";
      const primaryCat = txn.personal_finance_category?.primary ?? "";
      const detailCat = txn.personal_finance_category?.detailed ?? "";
      const catName = plaidCategoryToName(primaryCat, detailCat);
      const categoryId = catName ? catByName.get(catName.toLowerCase())?.id ?? null : null;

      await prisma.transaction.updateMany({
        where: { plaidTransactionId: txn.transaction_id, householdId: item.householdId },
        data: {
          amount,
          description: txn.name,
          date: parseISODay(txn.date),
          type,
          categoryId,
          cleared: !txn.pending,
        },
      });
      result.modified++;
    }

    // --- REMOVED ---
    for (const txn of data.removed) {
      await prisma.transaction.deleteMany({
        where: { plaidTransactionId: txn.transaction_id, householdId: item.householdId },
      });
      result.removed++;
    }
  }

  // ── Balance refresh ─────────────────────────────────────────────────────────
  const balanceResponse = await plaidClient.accountsBalanceGet({
    access_token: item.accessToken,
  });

  for (const acct of balanceResponse.data.accounts) {
    const linked = linkedByPlaidId.get(acct.account_id);
    if (!linked) continue;

    const balances = acct.balances;
    const newCurrent = balances.current ?? null;
    const newAvailable = balances.available ?? null;

    await prisma.plaidLinkedAccount.update({
      where: { id: linked.id },
      data: {
        currentBalance: newCurrent,
        availableBalance: newAvailable,
      },
    });

    // Keep the linked FinancialAccount balance in sync.
    if (linked.financialAccountId && newCurrent !== null) {
      await prisma.financialAccount.update({
        where: { id: linked.financialAccountId },
        data: { currentBalance: newCurrent },
      });
      result.balancesUpdated++;
    }
  }

  // Persist the cursor and last-synced time.
  await prisma.plaidItem.update({
    where: { id: plaidItemId },
    data: { cursor, lastSyncedAt: new Date(), error: null },
  });

  return result;
}
