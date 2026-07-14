# Transaction Tags - Design

Date: 2026-07-14
Status: Approved

## Summary

Free-form labels on transactions (e.g. "vacation 2026", "reimbursable", "tax-deductible") that
cut across categories. V1 ships all three roadmap pieces: manual tagging, tag-based filtering
with totals on the transactions page, and rule-based auto-tagging. Tag management (rename,
delete, merge, color) lives on a new Tags tab of the /categories page.

## Data model

New `Tag` model in `prisma/schema.prisma`:

```prisma
model Tag {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)

  name      String
  color     String   @default("#64748b")
  createdAt DateTime @default(now())

  transactions Transaction[]

  @@unique([userId, name])
  @@index([userId])
}
```

`Transaction` gains `tags Tag[]` via an implicit Prisma many-to-many join table.

Name rules: trimmed, inner whitespace collapsed, matched case-insensitively on create and
lookup (creating "Vacation" when "vacation" exists resolves to the existing tag), displayed
as first typed. Max length 40 characters. Empty names rejected.

Colors use the same palette approach as `Category.color`.

## Tagging UI

- New `TagInput` chip component: shows current tags as removable chips, autocompletes
  against the user's existing tags, Enter or comma creates a new tag from the typed text.
- Added to the existing single-transaction edit flow in the transactions list.
- Transaction rows render small colored tag chips after the description.
- The bulk-select bar in `TransactionsList.tsx` gains "Add tag" and "Remove tag" controls,
  following the same pattern as `bulkSetCategoryAction` (dropdown of existing tags; the add
  dropdown also allows creating a new tag).

## Filtering and totals

- New `tag` URL param on /transactions: comma-separated tag ids, validated against real
  rows like the existing category/account params.
- Multi-select tag dropdown next to the category/account filter dropdowns.
- OR semantics: a transaction matches if it has any selected tag. Server query uses
  `tags: { some: { id: { in: [...] } } }`. Client-side `filterTransactionDTOs` (demo mode)
  applies the same logic.
- Totals for the filtered view already recompute from the filtered set, so tag totals come
  free.
- Demo data gets a few seeded tags so filtering works in demo mode.

## Rule-based auto-tagging

- New action in `src/lib/rules.ts`: `{ type: "addTag"; tagId: string }`.
- Additive semantics, unlike `setCategory`: every matching rule contributes its tags, and
  they accumulate into a new `RuleEffect.addTagIds?: string[]` (deduplicated). Priority
  order and first-wins do not apply to this action.
- Applied everywhere rules already run: Plaid sync, CSV import, and the "apply to existing"
  backfill.
- The rules editor (`RulesCard` on /categories) gains the addTag action type with a tag
  picker.
- If a rule references a tag that has since been deleted, the action is skipped.

## Tag management page

/categories gets a Categories / Tags tab switch driven by a `?tab=tags` URL param (default
stays Categories). The Tags tab lists each tag with:

- color swatch with picker
- inline rename
- usage count and total amount across tagged transactions
- delete (untags transactions; never deletes transactions)
- merge: an explicit merge action in the row menu, and renaming a tag to an existing name
  prompts "merge into X?". Merging re-points transactions to the target tag, updates any
  rules referencing the merged tag, and deletes the duplicate.

New tags can also be created here directly.

## Edges

- Backup export/import includes tags and their transaction links.
- CSV export gains a tags column (names joined with "; ").
- Deleting a tag cascades cleanly via the join table; rules referencing it skip the action.

## Testing

Vitest unit tests following existing patterns:

- name normalization (trim, whitespace collapse, case-insensitive resolution, length limit)
- additive addTag rule effect (multiple rules accumulate, dedup, deleted-tag skip)
- tag filter parsing and OR filtering in `transactions-utils`
- merge logic (re-point transactions, update rules, delete duplicate)
- server-action tests in the style of the recent notifications/settings tests
