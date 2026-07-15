// Plaid transaction sync engine.
//
// Uses Plaid's cursor-based /transactions/sync so only new/modified/removed
// transactions are fetched after the first run. Designed to be called from an
// API route so it runs entirely server-side (access tokens never touch
// the browser).

import { getPlaidClient } from "./plaid";
import { prisma } from "./prisma";
import { parseISODay, isoDay } from "./dates";
import { expandOccurrences } from "./recurrence";
import { findTransferPairs, type MatchableTxn } from "./transfer-match";
import { evaluateRules, type RuleAction, type RuleCondition, type RuleLike } from "./rules";
import { captureNetWorthSnapshot } from "./snapshots";
import { toCents } from "./money";
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

// ── Recurring-rule matching (pure) ───────────────────────────────────────────

const TOKEN_NOISE = new Set(["ach", "the", "and", "from", "purchase", "payment", "withdrawal", "autopay", "early", "pay"]);

/** Tokenise a description to meaningful lowercase words (length >= 3). */
export function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !TOKEN_NOISE.has(t)),
  );
}

/** True if the two descriptions share a meaningful token or a >=5-char substring. */
export function descriptionMatches(txnDesc: string, ruleDesc: string): boolean {
  const ta = tokens(txnDesc);
  const tb = tokens(ruleDesc);
  for (const t of tb) if (ta.has(t)) return true;
  // Also check substring: "sunrun" inside "SUNRUN PURCHASE".
  const la = txnDesc.toLowerCase().replace(/[^a-z0-9]/g, "");
  const lb = ruleDesc.toLowerCase().replace(/[^a-z0-9]/g, "");
  for (const t of tb) if (t.length >= 5 && la.includes(t)) return true;
  for (const t of ta) if (t.length >= 5 && lb.includes(t)) return true;
  return false;
}

/** The recurring-rule fields needed to match a transaction against a rule. */
export interface MatchableRule {
  id: string;
  type: TxnType;
  /** number, or a Prisma Decimal - coerced with Number() before comparison. */
  amount: number | { toString(): string };
  description: string;
  frequency: Parameters<typeof expandOccurrences>[0]["frequency"];
  interval: number;
  startDate: Date;
  endDate: Date | null;
  dayOfMonth: number | null;
  weekday: number | null;
}

/**
 * Return the best-matching rule id for a transaction, or null.
 *
 * Matching criteria:
 * - Amount within 15% of the rule amount
 * - A scheduled occurrence falls within +/-2 days of the transaction date
 * - EXPENSE: description must share a token with the rule name
 *   (prevents coincidental amount matches, e.g. Shell ~ YouTube)
 * - INCOME: no description check (bank ACH descriptions never match
 *   human-readable names like "Vinny's Paycheck")
 */
export function matchRecurringRule(
  rules: MatchableRule[],
  type: TxnType,
  date: Date,
  amount: number,
  description: string,
): string | null {
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

/**
 * Sync a single Plaid item. Pass `userId` to scope the item lookup to that
 * owner - the lookup throws if the item doesn't belong to them, so callers get
 * a defensive ownership check rather than relying on having pre-verified it.
 */
export async function syncPlaidItem(
  plaidItemId: string,
  userId: string,
  opts?: SyncOptions,
): Promise<SyncResult> {
  const item = await prisma.plaidItem.findUniqueOrThrow({
    where: { id: plaidItemId, userId },
    include: {
      linkedAccounts: {
        include: { financialAccount: true },
      },
    },
  });


  const plaidClient = await getPlaidClient(item.userId);

  // Build a map from plaidAccountId → our linked account row.
  const linkedByPlaidId = new Map(item.linkedAccounts.map((a) => [a.plaidAccountId, a]));

  // Load the user's categories once so we can resolve names → ids.
  const categories = await prisma.category.findMany({ where: { userId: item.userId } });
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

  // User-defined rules beat Plaid's generic category mapping. Split actions are
  // left to the explicit "apply to existing" backfill (they need a follow-up
  // write keyed on the new row id); sync applies category, rename, and transfer.
  const ruleRows = await prisma.rule.findMany({ where: { userId: item.userId }, orderBy: { priority: "asc" } });
  const automationRules: RuleLike[] = ruleRows.map((r) => ({
    id: r.id,
    priority: r.priority,
    enabled: r.enabled,
    conditions: r.conditions as unknown as RuleCondition[],
    actions: r.actions as unknown as RuleAction[],
  }));

  const liveTagIds = new Set(
    (await prisma.tag.findMany({ where: { userId: item.userId }, select: { id: true } })).map((t) => t.id),
  );

  // Load recurring rules for matching. When a Plaid transaction lands on (or
  // within 2 days of) a rule's scheduled occurrence, we link the transaction
  // to that rule so the calendar suppresses the virtual projection in favour
  // of the live bank data.
  const rules = await prisma.recurringRule.findMany({
    where: { userId: item.userId, archived: false },
  });

  const matchRule = (type: TxnType, date: Date, amount: number, description: string) =>
    matchRecurringRule(rules, type, date, amount, description);

  const result: SyncResult = { added: 0, modified: 0, removed: 0, balancesUpdated: 0 };
  const newTxnIds: string[] = [];

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
      const linked = linkedByPlaidId.get(txn.account_id);
      if (!linked?.financialAccountId) continue; // account not linked to a local account yet

      // Plaid: positive amount = money out (expense), negative = money in (income).
      const isIncome = txn.amount < 0;
      const amount = Math.abs(txn.amount);
      const type: TxnType = isIncome ? "INCOME" : "EXPENSE";

      const primaryCat = txn.personal_finance_category?.primary ?? "";
      const detailCat = txn.personal_finance_category?.detailed ?? "";
      const catName = plaidCategoryToName(primaryCat, detailCat);
      const rawDescription = txn.merchant_name ?? txn.name;

      const effect = evaluateRules(
        { description: rawDescription, amountDollars: amount, accountId: linked.financialAccountId, type },
        automationRules,
      );
      const description = effect.description ?? rawDescription;
      const categoryId = effect.categoryId
        ?? (catName ? catByName.get(catName.toLowerCase())?.id ?? null : null);
      const isTransfer = effect.markTransfer ?? false;

      // Use authorized_date when available - it's when the user actually made
      // the purchase, vs. date which is the posting date for settled txns.
      const txnDate = parseISODay(txn.authorized_date ?? txn.date);
      const recurringRuleId = matchRule(type, txnDate, amount, description);

      // A full re-pull (recategorizeOnly resets the cursor) can return charges
      // we already have under a brand-new transaction_id - Plaid does not keep
      // ids stable across a cursor reset. The upsert keys on plaidTransactionId,
      // so a reissued id would slip through as a fresh row and duplicate the
      // charge. Guard against that: if no row matches the id but an existing
      // non-deleted row matches the charge by content, adopt that row (rebind
      // its plaidTransactionId) instead of creating a duplicate.
      if (opts?.recategorizeOnly) {
        const byId = await prisma.transaction.findUnique({
          where: { plaidTransactionId: txn.transaction_id },
          select: { id: true },
        });
        if (!byId) {
          const twin = await prisma.transaction.findFirst({
            where: {
              userId: item.userId,
              deletedAt: null,
              accountId: linked.financialAccountId,
              date: txnDate,
              amount,
              type,
              description,
            },
            select: { id: true },
          });
          if (twin) {
            await prisma.transaction.update({
              where: { id: twin.id },
              data: { plaidTransactionId: txn.transaction_id },
            });
          }
        }
      }

      const row = await prisma.transaction.upsert({
        where: { plaidTransactionId: txn.transaction_id },
        update: opts?.recategorizeOnly
          ? { amount, description, date: txnDate, type, cleared: !txn.pending, recurringRuleId, plaidPrimaryCategory: primaryCat || null, plaidDetailedCategory: detailCat || null }
          : { amount, description, date: txnDate, type, categoryId, isTransfer, cleared: !txn.pending, recurringRuleId, plaidPrimaryCategory: primaryCat || null, plaidDetailedCategory: detailCat || null },
        create: {
          userId: item.userId,
          accountId: linked.financialAccountId,
          categoryId,
          isTransfer,
          type,
          amount,
          date: txnDate,
          description,
          cleared: !txn.pending,
          plaidTransactionId: txn.transaction_id,
          recurringRuleId,
          plaidPrimaryCategory: primaryCat || null,
          plaidDetailedCategory: detailCat || null,
        },
      });
      if (!opts?.recategorizeOnly) newTxnIds.push(row.id);

      const tagIdsToAdd = (effect.addTagIds ?? []).filter((id) => liveTagIds.has(id));
      if (tagIdsToAdd.length > 0) {
        const current = await prisma.transaction.findUnique({
          where: { id: row.id },
          select: { tags: { select: { id: true } } },
        });
        const have = new Set(current?.tags.map((t) => t.id) ?? []);
        const missing = tagIdsToAdd.filter((id) => !have.has(id));
        if (missing.length > 0) {
          await prisma.transaction.update({
            where: { id: row.id },
            data: { tags: { connect: missing.map((id) => ({ id })) } },
          });
        }
      }

      // When a pending charge posts, Plaid delivers the settled version as a
      // new transaction (with its own id) that points back at the pending one
      // via pending_transaction_id. Plaid is supposed to also send the pending
      // id in `removed`, but that event is frequently missing, so reconcile
      // here to avoid a duplicate pending + posted pair for the same charge.
      if (txn.pending_transaction_id) {
        await prisma.transaction.deleteMany({
          where: {
            plaidTransactionId: txn.pending_transaction_id,
            userId: item.userId,
          },
        });
      }

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
      const linked = linkedByPlaidId.get(txn.account_id);
      if (!linked?.financialAccountId) continue;

      const isIncome = txn.amount < 0;
      const amount = Math.abs(txn.amount);
      const type: TxnType = isIncome ? "INCOME" : "EXPENSE";
      const primaryCat = txn.personal_finance_category?.primary ?? "";
      const detailCat = txn.personal_finance_category?.detailed ?? "";
      const catName = plaidCategoryToName(primaryCat, detailCat);
      const modDate = parseISODay(txn.authorized_date ?? txn.date);
      const rawModDesc = txn.merchant_name ?? txn.name;
      const modEffect = evaluateRules(
        { description: rawModDesc, amountDollars: amount, accountId: linked.financialAccountId, type },
        automationRules,
      );
      const modDesc = modEffect.description ?? rawModDesc;
      const categoryId = modEffect.categoryId
        ?? (catName ? catByName.get(catName.toLowerCase())?.id ?? null : null);
      const isTransfer = modEffect.markTransfer ?? false;
      const modRuleId = matchRule(type, modDate, amount, modDesc);

      await prisma.transaction.updateMany({
        where: { plaidTransactionId: txn.transaction_id, userId: item.userId },
        data: opts?.recategorizeOnly
          ? { amount, description: modDesc, date: modDate, type, cleared: !txn.pending, recurringRuleId: modRuleId, plaidPrimaryCategory: primaryCat || null, plaidDetailedCategory: detailCat || null }
          : { amount, description: modDesc, date: modDate, type, categoryId, isTransfer, cleared: !txn.pending, recurringRuleId: modRuleId, plaidPrimaryCategory: primaryCat || null, plaidDetailedCategory: detailCat || null },
      });

      const modTagIds = (modEffect.addTagIds ?? []).filter((id) => liveTagIds.has(id));
      if (modTagIds.length > 0) {
        const target = await prisma.transaction.findFirst({
          where: { plaidTransactionId: txn.transaction_id, userId: item.userId },
          select: { id: true, tags: { select: { id: true } } },
        });
        if (target) {
          const missing = modTagIds.filter((id) => !target.tags.some((x) => x.id === id));
          if (missing.length > 0) {
            await prisma.transaction.update({
              where: { id: target.id },
              data: { tags: { connect: missing.map((id) => ({ id })) } },
            });
          }
        }
      }

      // Same pending→posted reconciliation as in the added loop: drop the
      // pending row this settled transaction superseded.
      if (txn.pending_transaction_id) {
        await prisma.transaction.deleteMany({
          where: {
            plaidTransactionId: txn.pending_transaction_id,
            userId: item.userId,
          },
        });
      }

      // In recategorize mode, fill in the category only if the row has none.
      if (opts?.recategorizeOnly && categoryId) {
        await prisma.transaction.updateMany({
          where: { plaidTransactionId: txn.transaction_id, userId: item.userId, categoryId: null },
          data: { categoryId },
        });
      }

      result.modified++;
    }

    // --- REMOVED ---
    for (const txn of data.removed) {
      await prisma.transaction.deleteMany({
        where: { plaidTransactionId: txn.transaction_id, userId: item.userId },
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
    const newLimit = balances.limit ?? null;

    await prisma.plaidLinkedAccount.update({
      where: { id: linked.id },
      data: {
        currentBalance: newCurrent,
        availableBalance: newAvailable,
        creditLimit: newLimit,
      },
    });

    // Keep the linked FinancialAccount balance and credit limit in sync.
    if (linked.financialAccountId && newCurrent !== null) {
      await prisma.financialAccount.update({
        where: { id: linked.financialAccountId },
        data: {
          currentBalance: newCurrent,
          ...(newLimit !== null ? { creditLimit: newLimit } : {}),
        },
      });
      result.balancesUpdated++;
    }
  }

  // ── Liabilities (statement balance, min payment, due date) ──────────────────
  try {
    const liabResp = await plaidClient.liabilitiesGet({ access_token: item.accessToken });
    for (const card of liabResp.data.liabilities.credit ?? []) {
      if (!card.account_id) continue;
      const linked = linkedByPlaidId.get(card.account_id);
      if (!linked?.financialAccountId) continue;
      await prisma.financialAccount.update({
        where: { id: linked.financialAccountId },
        data: {
          lastStatementBalance: card.last_statement_balance ?? null,
          lastStatementDate: card.last_statement_issue_date ? new Date(`${card.last_statement_issue_date}T00:00:00Z`) : null,
          lastPaymentAmount: card.last_payment_amount ?? null,
          lastPaymentDate: card.last_payment_date ? new Date(`${card.last_payment_date}T00:00:00Z`) : null,
          minimumPayment: card.minimum_payment_amount ?? null,
          nextPaymentDueDate: card.next_payment_due_date ? new Date(`${card.next_payment_due_date}T00:00:00Z`) : null,
          isOverdue: card.is_overdue ?? null,
        },
      });
    }
  } catch {
    // Liabilities product may not be available for all items (e.g. non-credit
    // accounts or items linked before Liabilities was added). Non-fatal.
  }

  // Persist the cursor and last-synced time (skipped in recategorize mode so
  // the real sync position is not disturbed).
  if (!opts?.recategorizeOnly) {
    await matchTransfers(item.userId);
    await prisma.plaidItem.update({
      where: { id: plaidItemId },
      data: { cursor, lastSyncedAt: new Date(), error: null, failureCount: 0 },
    });
    // Record a net-worth snapshot now that balances are up to date. Non-fatal:
    // a failed snapshot must not fail the sync.
    try {
      await captureNetWorthSnapshot(item.userId);
    } catch {
      /* ignore */
    }
    // Fire event-mode notification rules with this sync's outcome. Non-fatal.
    try {
      const { runRules } = await import("@/lib/notifications/engine");
      await runRules(item.userId, {
        mode: "event",
        event: { kind: "plaid-sync", plaidItemId, newTransactionIds: newTxnIds },
      });
    } catch (e) {
      console.error("[notifications] post-sync rules failed:", e);
    }
  }

  return result;
}

/**
 * Pair credit-card payment credits with the bank expense that funded them
 * across the last 90 days, so neither side counts as income/spending.
 */
export async function matchTransfers(userId: string): Promise<number> {
  const since = new Date(Date.now() - 90 * 86_400_000);
  const [accounts, txns] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { userId },
      select: { id: true, type: true },
    }),
    prisma.transaction.findMany({
      where: { userId, deletedAt: null, date: { gte: since } },
      select: { id: true, type: true, amount: true, date: true, accountId: true, isTransfer: true, transferPeerId: true },
    }),
  ]);

  const ccIds = new Set(accounts.filter((a) => a.type === "CREDIT_CARD").map((a) => a.id));
  const matchable: MatchableTxn[] = txns.map((t) => ({
    id: t.id,
    type: t.type,
    amountCents: toCents(t.amount),
    dateISO: isoDay(t.date),
    accountId: t.accountId,
    isTransfer: t.isTransfer,
    transferPeerId: t.transferPeerId,
  }));

  const pairs = findTransferPairs(matchable, (id) => ccIds.has(id));
  for (const pair of pairs) {
    await prisma.$transaction([
      prisma.transaction.update({
        where: { id: pair.expenseId },
        data: { isTransfer: true, transferPeerId: pair.incomeId },
      }),
      prisma.transaction.update({
        where: { id: pair.incomeId },
        data: { isTransfer: true },
      }),
    ]);
  }
  return pairs.length;
}
