// Plaid transaction sync engine.
//
// Uses Plaid's cursor-based /transactions/sync so only new/modified/removed
// transactions are fetched after the first run. Designed to be called from an
// API route so it runs entirely server-side (access tokens never touch
// the browser).

import { plaidClient } from "./plaid";
import { prisma } from "./prisma";
import { parseISODay } from "./dates";
import { expandOccurrences } from "./recurrence";
import type { TxnType } from "@/generated/prisma/enums";

// ── Plaid account type → our AccountType ─────────────────────────────────────

// ── Plaid category → our default-category name (best-effort) ─────────────────

export const CATEGORY_MAP: Record<string, string> = {
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

export function plaidCategoryToName(primaryCategory: string, detailCategory?: string): string | null {
  // Plaid's detailed category already includes the primary prefix
  // (e.g. "FOOD_AND_DRINK_RESTAURANT"), so use it directly as the map key.
  if (detailCategory && CATEGORY_MAP[detailCategory]) return CATEGORY_MAP[detailCategory];
  return CATEGORY_MAP[primaryCategory] ?? null;
}

// ── Main sync function ────────────────────────────────────────────────────────

export interface SyncResult {
  added: number;
  modified: number;
  removed: number;
  balancesUpdated: number;
}

export interface SyncOptions {
  /** Re-fetch all historical transactions from Plaid and fill in any categoryId
   *  that is currently null, without overwriting categories the user set manually. */
  recategorizeOnly?: boolean;
}

export async function syncPlaidItem(plaidItemId: string, opts?: SyncOptions): Promise<SyncResult> {
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

  // Load recurring rules for matching. When a Plaid transaction lands on (or
  // within 2 days of) a rule's scheduled occurrence, we link the transaction
  // to that rule so the calendar suppresses the virtual projection in favour
  // of the live bank data.
  const rules = await prisma.recurringRule.findMany({
    where: { householdId: item.householdId, archived: false },
  });

  /** Tokenise a description to meaningful lowercase words (length ≥ 3). */
  function tokens(s: string): Set<string> {
    const NOISE = new Set(["ach", "the", "and", "from", "purchase", "payment", "withdrawal", "autopay", "early", "pay"]);
    return new Set(
      s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !NOISE.has(t))
    );
  }

  /** True if the two descriptions share at least one meaningful token. */
  function descriptionMatches(txnDesc: string, ruleDesc: string): boolean {
    const ta = tokens(txnDesc);
    const tb = tokens(ruleDesc);
    for (const t of tb) if (ta.has(t)) return true;
    // Also check substring: "sunrun" inside "SUNRUN PURCHASE"
    const la = txnDesc.toLowerCase().replace(/[^a-z0-9]/g, "");
    const lb = ruleDesc.toLowerCase().replace(/[^a-z0-9]/g, "");
    for (const t of tb) if (t.length >= 5 && la.includes(t)) return true;
    for (const t of ta) if (t.length >= 5 && lb.includes(t)) return true;
    return false;
  }

  /**
   * Return the best-matching rule id for a transaction, or null.
   *
   * Matching criteria:
   * - Amount within 15% of the rule amount
   * - A scheduled occurrence falls within ±2 days of the transaction date
   * - EXPENSE: description must share a token with the rule name
   *   (prevents coincidental amount matches, e.g. Shell ≈ YouTube)
   * - INCOME: no description check (bank ACH descriptions never match
   *   human-readable names like "Vinny's Paycheck")
   */
  function matchRule(type: TxnType, date: Date, amount: number, description: string): string | null {
    const tolerance = amount * 0.15;
    const windowMs = 2 * 86_400_000;
    const windowStart = new Date(date.getTime() - windowMs);
    const windowEnd = new Date(date.getTime() + windowMs);

    for (const rule of rules) {
      if (rule.type !== type) continue;
      if (Math.abs(Number(rule.amount) - amount) > tolerance) continue;
      if (type === "EXPENSE" && !descriptionMatches(description, rule.description)) continue;

      const occs = expandOccurrences(
        { frequency: rule.frequency, interval: rule.interval, startDate: rule.startDate, endDate: rule.endDate, dayOfMonth: rule.dayOfMonth, weekday: rule.weekday },
        windowStart,
        windowEnd,
      );
      if (occs.length > 0) return rule.id;
    }
    return null;
  }

  const result: SyncResult = { added: 0, modified: 0, removed: 0, balancesUpdated: 0 };

  // ── Paginated transaction sync ──────────────────────────────────────────────
  // recategorizeOnly: start from the beginning of history so all transactions
  // are visited, but do not advance the item's real cursor when done.
  let cursor = opts?.recategorizeOnly ? undefined : (item.cursor ?? undefined);
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

      const txnDate = parseISODay(txn.date);
      const recurringRuleId = matchRule(type, txnDate, amount, txn.name);

      await prisma.transaction.upsert({
        where: { plaidTransactionId: txn.transaction_id },
        update: opts?.recategorizeOnly
          ? { amount, description: txn.name, date: txnDate, type, cleared: !txn.pending, recurringRuleId, plaidPrimaryCategory: primaryCat || null, plaidDetailedCategory: detailCat || null }
          : { amount, description: txn.name, date: txnDate, type, categoryId, cleared: !txn.pending, recurringRuleId, plaidPrimaryCategory: primaryCat || null, plaidDetailedCategory: detailCat || null },
        create: {
          householdId: item.householdId,
          accountId: linked.financialAccountId,
          categoryId,
          type,
          amount,
          date: txnDate,
          description: txn.name,
          cleared: !txn.pending,
          plaidTransactionId: txn.transaction_id,
          recurringRuleId,
          plaidPrimaryCategory: primaryCat || null,
          plaidDetailedCategory: detailCat || null,
        },
      });

      // In recategorize mode, fill in the category only if the row has none.
      if (opts?.recategorizeOnly && categoryId) {
        await prisma.transaction.updateMany({
          where: { plaidTransactionId: txn.transaction_id, categoryId: null },
          data: { categoryId },
        });
      }

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

      const modDate = parseISODay(txn.date);
      const modRuleId = matchRule(type, modDate, amount, txn.name);

      await prisma.transaction.updateMany({
        where: { plaidTransactionId: txn.transaction_id, householdId: item.householdId },
        data: opts?.recategorizeOnly
          ? { amount, description: txn.name, date: modDate, type, cleared: !txn.pending, recurringRuleId: modRuleId, plaidPrimaryCategory: primaryCat || null, plaidDetailedCategory: detailCat || null }
          : { amount, description: txn.name, date: modDate, type, categoryId, cleared: !txn.pending, recurringRuleId: modRuleId, plaidPrimaryCategory: primaryCat || null, plaidDetailedCategory: detailCat || null },
      });

      // In recategorize mode, fill in the category only if the row has none.
      if (opts?.recategorizeOnly && categoryId) {
        await prisma.transaction.updateMany({
          where: { plaidTransactionId: txn.transaction_id, householdId: item.householdId, categoryId: null },
          data: { categoryId },
        });
      }

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

  // Persist the cursor and last-synced time (skipped in recategorize mode so
  // the real sync position is not disturbed).
  if (!opts?.recategorizeOnly) {
    await prisma.plaidItem.update({
      where: { id: plaidItemId },
      data: { cursor, lastSyncedAt: new Date(), error: null },
    });
  }

  return result;
}
