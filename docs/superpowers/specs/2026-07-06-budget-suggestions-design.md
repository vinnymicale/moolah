# Suggested Budget from Recurring Charges — Design

**Date:** 2026-07-06
**Status:** Approved by user

## Goal

Give the user a suggested baseline budget on the Budgets page, computed from past
recurring charges across all linked accounts. The user can accept, decline, or edit
the suggested amount per category — including excluding specific contributing charges
from the computation.

## Data sources

- **Saved rules:** active (non-archived) `RecurringRule` rows with `type = EXPENSE`.
- **Detected charges:** recurring-expense groups found by the existing
  `detectRecurringCandidates` in `src/lib/recurring-suggestions.ts`, run over the last
  ~12 months of non-deleted, non-transfer transactions across **all** accounts.
- **Dedupe:** rules win. Detected groups are dropped when their transactions are linked
  to a rule (`recurringRuleId`, already handled by the detector) or when their
  description fuzzy-matches an existing rule description / linked-transaction
  description (`descriptionsLikelySame`, same approach as `getRecurringSuggestions`).

## Computation (pure lib: `src/lib/budget-suggestions.ts`)

- Normalize each item to a monthly amount: MONTHLY ×1, WEEKLY ×52/12, BIWEEKLY ×26/12,
  YEARLY ÷12, DAILY ×365/12; all divided by `interval`. Cents-safe math via
  `toCents`/`fromCents`.
- Group items by `categoryId`; suggested amount per category = sum of item monthly
  amounts, **rounded up to the nearest dollar** at the category level.
- Exclude INCOME items (budgets are per-category spending limits).
- Items with no category are excluded from category totals but returned in a separate
  `uncategorized` list so the UI can note "N recurring charges weren't included."
- Output per category: `{ categoryId, suggested, items[] }` where each item is
  `{ id, description, source: "rule" | "detected", cadence, monthlyAmount }`.

## Server actions (`src/actions/budget-suggestions.ts`)

- `getBudgetSuggestionsAction(month)` — auth, load rules + last-12-months transactions
  + expense categories + existing budgets for the month; run the pure lib; return
  `{ categories: [{categoryId, name, color, icon, currentLimit, suggested, items[]}],
  uncategorizedCount }`. Demo-mode returns a small canned result.
- `applyBudgetSuggestionsAction({ month, entries: [{categoryId, limit}] })` —
  validates category ownership, batch-upserts `Budget` rows in a transaction
  (mirrors `copyBudgetsAction`), revalidates `/budgets`, `/trends`, `/`.

## UI (`src/app/(app)/budgets/SuggestBudgetModal.tsx`)

- Entry points: a **Suggest** button (Sparkles icon) in the Budgets toolbar, plus a
  link in the no-budgets empty state. Both open the modal, which fetches suggestions
  via the action and shows a loading state.
- Each suggested category row: icon/name, editable amount input, expandable list of
  contributing charges with checkboxes. Unchecking a charge recomputes the category
  amount live unless the user manually edited the amount (their edit sticks).
- Category-level checkbox controls whether it's applied. Categories with an existing
  limit show "current $X → suggested $Y" and default **unchecked**; new categories
  default checked.
- Footer: "Apply N budgets" and "Cancel". Apply calls the action; on success the modal
  closes and revalidation refreshes the page.

## Testing

- Unit tests for the pure lib: frequency normalization, interval handling, rounding up,
  rule/detected dedupe, income exclusion, uncategorized handling.
- Action tests following the existing `src/actions/budgets.test.ts` mock style.
