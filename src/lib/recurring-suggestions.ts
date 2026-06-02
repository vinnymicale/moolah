// Recurring-charge detection.
//
// Scans concrete transactions for groups that look like they repeat on a
// regular cadence (subscriptions, bills, paychecks) and proposes a recurring
// rule for each. Pure and synchronous so it's easy to unit-test; the server
// layer feeds it transactions and existing-rule descriptions.

import { toCents, fromCents } from "./money";

export type SuggestType = "INCOME" | "EXPENSE";
export type SuggestFrequency = "WEEKLY" | "BIWEEKLY" | "MONTHLY" | "YEARLY";

export interface TxnForDetect {
  date: string; // YYYY-MM-DD
  description: string;
  amount: number;
  type: SuggestType;
  categoryId: string | null;
  accountId: string | null;
  recurringRuleId: string | null;
}

export interface RecurringSuggestion {
  key: string;
  description: string;
  amount: number;
  type: SuggestType;
  frequency: SuggestFrequency;
  interval: number;
  /** How many matching transactions were seen. */
  count: number;
  categoryId: string | null;
  accountId: string | null;
  /** Suggested anchor (most recent occurrence). */
  startDate: string;
  /** Human cadence label, e.g. "about monthly". */
  cadence: string;
}

const NOISE = new Set([
  "ach", "pos", "debit", "credit", "withdrawal", "deposit", "purchase", "payment",
  "autopay", "early", "pay", "from", "the", "online", "recurring", "bill", "llc", "inc", "co",
]);

/** Collapse a bank description to a stable grouping key for one merchant/payer. */
export function normalizeDescription(desc: string): string {
  return desc
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length > 2 && !/\d/.test(tok) && !NOISE.has(tok))
    .join(" ")
    .trim();
}

/** Distinctive (alpha, length ≥ 4, non-noise) tokens used for fuzzy matching. */
function matchTokens(desc: string): string[] {
  return desc
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((tok) => tok.length >= 4 && !/\d/.test(tok) && !NOISE.has(tok));
}

/**
 * Heuristic: do two descriptions likely refer to the same merchant/payer even
 * when worded differently? True when they share a distinctive token, or when a
 * longer token of one appears inside the other's concatenated form — so
 * "GOOGLE *YOUTUBE" matches "YouTube Premium" and "PRIVATEINTERNET" matches
 * "Private Internet Access (VPN)".
 */
export function descriptionsLikelySame(a: string, b: string): boolean {
  const ta = matchTokens(a);
  const tb = matchTokens(b);
  if (ta.length === 0 || tb.length === 0) return false;

  const setB = new Set(tb);
  const joinedA = ta.join("");
  const joinedB = tb.join("");

  for (const t of ta) {
    if (setB.has(t)) return true; // shared whole token, e.g. "youtube"
    if (t.length >= 6 && joinedB.includes(t)) return true; // "privateinternet" ⊂ "privateinternetaccess"
  }
  for (const t of tb) {
    if (t.length >= 6 && joinedA.includes(t)) return true; // "private" ⊂ "privateinternet"
  }
  return false;
}

function median(nums: number[]): number {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function daysBetweenISO(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

/** Map a median gap (days) to a frequency + interval, or null if irregular. */
function cadenceFromGap(gap: number): { frequency: SuggestFrequency; interval: number; cadence: string } | null {
  if (gap >= 5 && gap <= 9) return { frequency: "WEEKLY", interval: 1, cadence: "about weekly" };
  if (gap >= 11 && gap <= 17) return { frequency: "BIWEEKLY", interval: 1, cadence: "every ~2 weeks" };
  if (gap >= 25 && gap <= 35) return { frequency: "MONTHLY", interval: 1, cadence: "about monthly" };
  if (gap >= 55 && gap <= 66) return { frequency: "MONTHLY", interval: 2, cadence: "every ~2 months" };
  if (gap >= 85 && gap <= 95) return { frequency: "MONTHLY", interval: 3, cadence: "about quarterly" };
  if (gap >= 350 && gap <= 380) return { frequency: "YEARLY", interval: 1, cadence: "about yearly" };
  return null;
}

function mostCommon<T>(values: T[]): T | undefined {
  const counts = new Map<T, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best: T | undefined;
  let bestN = 0;
  for (const [v, n] of counts) {
    if (n > bestN) { best = v; bestN = n; }
  }
  return best;
}

export interface DetectOptions {
  /** Raw descriptions of existing rules; candidates that fuzzy-match any of
   *  these are skipped so we don't suggest something already covered. */
  existingDescriptions?: string[];
  /** Minimum occurrences to qualify (default 3). */
  minCount?: number;
  /** Cap on number of suggestions returned (default 12). */
  limit?: number;
}

export function detectRecurringCandidates(txns: TxnForDetect[], opts: DetectOptions = {}): RecurringSuggestion[] {
  const { existingDescriptions = [], minCount = 3, limit = 12 } = opts;

  // Group eligible transactions by (type, normalized description).
  const groups = new Map<string, TxnForDetect[]>();
  for (const t of txns) {
    if (t.recurringRuleId) continue; // already part of a series
    const key = normalizeDescription(t.description);
    if (!key) continue;
    const gk = `${t.type}|${key}`;
    (groups.get(gk) ?? groups.set(gk, []).get(gk)!).push(t);
  }

  const suggestions: RecurringSuggestion[] = [];

  for (const [gk, items] of groups) {
    if (items.length < minCount) continue;

    const sorted = [...items].sort((a, b) => a.date.localeCompare(b.date));
    const gaps: number[] = [];
    for (let i = 1; i < sorted.length; i++) gaps.push(daysBetweenISO(sorted[i - 1].date, sorted[i].date));
    if (gaps.length === 0) continue;

    const med = median(gaps);
    const cadence = cadenceFromGap(med);
    if (!cadence) continue;

    // Consistency: most gaps should sit near the median.
    const tol = Math.max(3, med * 0.35);
    const consistent = gaps.filter((g) => Math.abs(g - med) <= tol).length;
    if (consistent / gaps.length < 0.6) continue;

    const amount = fromCents(Math.round(median(items.map((t) => toCents(t.amount)))));
    if (amount <= 0) continue;

    const last = sorted[sorted.length - 1];
    const description = mostCommon(items.map((t) => t.description)) ?? last.description;

    // Skip merchants already covered by a recurring rule, even if named slightly
    // differently (e.g. "GOOGLE *YOUTUBE" vs "YouTube Premium").
    if (existingDescriptions.some((d) => descriptionsLikelySame(description, d))) continue;

    suggestions.push({
      key: gk,
      description,
      amount,
      type: last.type,
      frequency: cadence.frequency,
      interval: cadence.interval,
      count: items.length,
      categoryId: mostCommon(items.map((t) => t.categoryId).filter((c): c is string => !!c)) ?? null,
      accountId: mostCommon(items.map((t) => t.accountId).filter((a): a is string => !!a)) ?? null,
      startDate: last.date,
      cadence: cadence.cadence,
    });
  }

  return suggestions
    .sort((a, b) => b.count - a.count || b.amount - a.amount)
    .slice(0, limit);
}
