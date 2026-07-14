// Rule matching engine for the rules & automation center.
//
// A rule matches a transaction when every one of its conditions holds (AND) and
// then contributes its actions: set a category, rewrite a messy payee
// description, mark the transaction a transfer, or split it across categories by
// ratio. Pure (no Prisma) so it can be unit-tested and called from Plaid sync,
// CSV import, and the "apply to existing" backfill alike.
//
// Rules run in priority order (lower first). For single-valued effects the first
// matching rule wins, mirroring the old "most specific rule wins" behaviour but
// driven by an explicit priority now that rules carry multiple conditions.

export type RuleCondition =
  | { type: "descriptionContains"; value: string } // case-insensitive substring
  | { type: "amountRange"; min?: number; max?: number } // dollars, inclusive
  | { type: "account"; accountId: string }
  | { type: "type"; txnType: "INCOME" | "EXPENSE" };

export interface SplitPart {
  categoryId: string;
  ratio: number; // 0..1; parts of a split action sum to ~1
}

export type RuleAction =
  | { type: "setCategory"; categoryId: string }
  | { type: "rewriteDescription"; to: string }
  | { type: "markTransfer" }
  | { type: "split"; parts: SplitPart[] }
  | { type: "addTag"; tagId: string };

export interface RuleLike {
  id: string;
  priority: number;
  enabled: boolean;
  conditions: RuleCondition[];
  actions: RuleAction[];
}

// What's known about a transaction at evaluation time.
export interface TxnFacts {
  description: string;
  amountDollars: number;
  accountId: string | null;
  type: "INCOME" | "EXPENSE";
}

export interface RuleEffect {
  categoryId?: string;
  description?: string;
  markTransfer?: boolean;
  splits?: SplitPart[];
  addTagIds?: string[];
}

function conditionMatches(cond: RuleCondition, facts: TxnFacts): boolean {
  switch (cond.type) {
    case "descriptionContains": {
      const needle = cond.value.trim().toLowerCase();
      if (!needle) return false;
      return facts.description.toLowerCase().includes(needle);
    }
    case "amountRange": {
      if (cond.min != null && facts.amountDollars < cond.min) return false;
      if (cond.max != null && facts.amountDollars > cond.max) return false;
      // A range with neither bound set is meaningless; don't let it match all.
      return cond.min != null || cond.max != null;
    }
    case "account":
      return facts.accountId != null && facts.accountId === cond.accountId;
    case "type":
      return facts.type === cond.txnType;
  }
}

/** True when the rule is enabled, has at least one condition, and all hold. */
export function ruleMatches(rule: RuleLike, facts: TxnFacts): boolean {
  if (!rule.enabled) return false;
  if (rule.conditions.length === 0) return false; // never match-everything by accident
  return rule.conditions.every((c) => conditionMatches(c, facts));
}

/**
 * Merge the effects of all matching rules, in priority order. For single-valued
 * effects (category, description, transfer) the first matching rule wins. A
 * split action overrides setCategory for that transaction (the splits carry the
 * attribution instead). The first matching split wins.
 */
export function evaluateRules(facts: TxnFacts, rules: RuleLike[]): RuleEffect {
  const ordered = [...rules].sort((a, b) => a.priority - b.priority);
  const effect: RuleEffect = {};

  for (const rule of ordered) {
    if (!ruleMatches(rule, facts)) continue;
    for (const action of rule.actions) {
      switch (action.type) {
        case "setCategory":
          if (effect.categoryId === undefined) effect.categoryId = action.categoryId;
          break;
        case "rewriteDescription":
          if (effect.description === undefined) effect.description = action.to;
          break;
        case "markTransfer":
          if (effect.markTransfer === undefined) effect.markTransfer = true;
          break;
        case "split":
          if (effect.splits === undefined && action.parts.length > 0) effect.splits = action.parts;
          break;
      }
    }
  }

  // A split supersedes a single category; the parts hold the attribution.
  if (effect.splits) effect.categoryId = undefined;
  return effect;
}

/**
 * Turn split ratios into cent-exact amounts that sum to `amountCents`. Uses
 * largest-remainder rounding so the parts always total the original amount (the
 * same invariant the manual split UI enforces).
 */
export function splitByRatio(
  amountCents: number,
  parts: SplitPart[],
): { categoryId: string; amountCents: number }[] {
  const totalRatio = parts.reduce((s, p) => s + p.ratio, 0);
  if (totalRatio <= 0) return [];

  const raw = parts.map((p) => (amountCents * p.ratio) / totalRatio);
  const floored = raw.map((r) => Math.floor(r));
  let remainder = amountCents - floored.reduce((s, n) => s + n, 0);

  // Hand the leftover cents to the parts with the largest fractional remainders.
  const order = raw
    .map((r, i) => ({ i, frac: r - Math.floor(r) }))
    .sort((a, b) => b.frac - a.frac);

  const amounts = [...floored];
  for (const { i } of order) {
    if (remainder <= 0) break;
    amounts[i] += 1;
    remainder -= 1;
  }

  return parts.map((p, i) => ({ categoryId: p.categoryId, amountCents: amounts[i] }));
}
