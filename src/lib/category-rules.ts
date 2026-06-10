// Auto-categorization rule matching.
//
// A rule assigns a category when its pattern appears in the transaction
// description (case-insensitive contains). The longest matching pattern wins
// so "costco gas" beats "costco". Pure so it can be unit-tested; Plaid sync
// and CSV import call this, and rules always beat Plaid's generic mapping.

export interface CategoryRuleLike {
  pattern: string;
  categoryId: string;
}

export function matchCategoryRule(description: string, rules: CategoryRuleLike[]): string | null {
  const desc = description.toLowerCase();
  let best: CategoryRuleLike | null = null;
  for (const rule of rules) {
    const pattern = rule.pattern.trim().toLowerCase();
    if (!pattern || !desc.includes(pattern)) continue;
    if (!best || pattern.length > best.pattern.trim().length) best = rule;
  }
  return best?.categoryId ?? null;
}
