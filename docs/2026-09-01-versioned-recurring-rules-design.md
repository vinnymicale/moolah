# Versioned recurring rules

## Problem

A recurring rule holds a single amount and schedule. When rent goes from $2,300 to
$2,450, editing the rule rewrites what every past month looked like: the calendar's
projected occurrences for January through August all redraw at $2,450, and so do the
forecasts and budget suggestions that read from the rule.

Materialised transactions - months where a real charge was recorded and linked to the
rule - already keep their own amounts, so they are not affected. The damage is confined
to *virtual* occurrences, which is most of the calendar's past for any rule the user
hasn't been reconciling against a bank feed.

The schedule has the same problem in a worse form. A rule holds one `startDate`, so
moving a charge from the 5th to the 10th of the month has no correct expression: editing
`dayOfMonth` retroactively claims the charge was always on the 10th, and editing
`startDate` claims the series began later than it did. Users work around this by creating
a second rule, which splits the history and breaks the link between the two halves.

## Approach

Split `RecurringRule` into a stable identity row and a list of versions. A version is the
rule as it stood from a date forward. Expansion walks the versions, so any point in time
projects with the rule that was in force then.

The alternatives considered and rejected:

- **Amount-only history table.** Simpler, but leaves the 5th-to-10th case unsolved,
  which is half the problem.
- **Chained rules linked by `supersedes`.** No new table, but rule ids multiply. Linked
  transactions, archived state, and the suggestion detector's dedup all key off a single
  rule id, and each would need to learn to follow the chain.

## Data model

```
RecurringRule
  id, userId, description, archived, createdAt, updatedAt
  versions      RecurringRuleVersion[]
  transactions  Transaction[]

RecurringRuleVersion
  id, ruleId
  effectiveFrom  DateTime    // UTC midnight
  type, amount, accountId, categoryId, note
  frequency, interval, dayOfMonth, weekday
  startDate, endDate
  createdAt
  @@unique([ruleId, effectiveFrom])
  @@index([ruleId])
```

`description` stays on the rule. It is the identity users match on, and it is what the
suggestion detector's dedup and the Plaid matcher key off; a per-version name would
fragment both. Renaming is therefore always retroactive.

`type` lives on the version. Flipping income to expense is rare, but leaving `type` on
the rule would make a version a partial record of the rule's state, and the column costs
nothing.

A rule always has at least one version. The first version's `effectiveFrom` equals the
rule's `startDate`.

### Migration

1. Create `RecurringRuleVersion`.
2. For each existing `RecurringRule`, insert one version carrying its current field
   values, with `effectiveFrom = startDate`.
3. Drop the versioned columns from `RecurringRule`.

A single-version rule expands exactly as it does today, so behaviour after the migration
is unchanged.

## Expansion

Consumers today build a flat object and call `expandOccurrences(rule, start, end)`. That
function is untouched - it stays the pure date-math primitive and keeps its tests. A new
function in `src/lib/recurrence.ts` layers over it:

```ts
export function expandVersioned(
  rule: { versions: RuleVersion[] },   // sorted by effectiveFrom
  rangeStart: Date,
  rangeEnd: Date,
): { date: Date; version: RuleVersion }[]
```

Version `v[i]` is in force over `[v[i].effectiveFrom, v[i+1].effectiveFrom)`. The interval
is half-open, so a date falling exactly on a boundary belongs to the newer version and can
never be counted twice. For each version, intersect its interval with the requested window,
call `expandOccurrences` on the intersection, and tag each resulting date with its version.
The final version's interval is unbounded above, subject to its own `endDate`.

A second helper covers the sites that only need the rule as it stands now:

```ts
export function currentVersion(rule, asOf: Date): RuleVersion
```

### Effect on a schedule change

Moving a monthly charge from the 5th to the 10th, versioned at Sep 10, yields an
occurrence on Sep 5 from the old version and another on Sep 10 from the new one. Two
charges in September. That is arithmetically correct for a move that genuinely happened
mid-month, but it is rarely what the user means, so the modal defaults the effective date
of a schedule change to the next occurrence under the *old* schedule (Sep 5). The old
version's last occurrence is then Aug 5 and the new version's first is Sep 10 - one charge
in September.

### Consumer changes

Each of these swaps `expandOccurrences` for `expandVersioned` and reads `amount`,
`categoryId`, and `accountId` off the returned version:

- `src/lib/calendar.ts` (both the upcoming-items and month-grid expansions) - the site
  where a historical amount actually becomes visible
- `src/lib/networth-forecast.ts` - future-only, so it always resolves to the latest
  version, but goes through the same path for consistency
- `src/lib/plaid-sync.ts` - the +/-15% amount tolerance must compare against the version in
  force on the *transaction's* date, not the newest one
- `src/actions/import.ts`
- `src/lib/notifications/triggers/recurring-missing.ts`,
  `src/lib/notifications/triggers/paycheck-missing.ts`
- `src/lib/retirement-projection.ts`, `src/lib/retirement-growth.ts`

These need only `currentVersion`:

- `src/lib/budget-suggestions.ts`
- `src/app/api/chat/route.ts`
- `src/lib/queries/recurring.ts` - flattens the current version into `RecurringDTO` so the
  list UI is unchanged

## Edit modal

The current form presents one flat set of fields plus a bare `startDate`, which is what
makes a schedule change read as "I need a new rule."

**Mode selector** at the top of the edit form, two radio options:

- *Change going forward* (default). A date field appears beside it, prefilled with the
  next occurrence under the current schedule. Below it, a line that recomputes as fields
  change: "Occurrences before Sep 5 keep the current amount. First charge at the new
  amount: Oct 10." The user sees the double-charge case in the form rather than
  discovering it on the calendar.
- *Fix this rule everywhere*. No date field. Edits the version in force today in place.
  Sub-label: "Corrects history too. Use for typos and wrong entries."

**`startDate` is no longer editable on the edit form.** It means "when this series began,"
and making it editable is what suggests an edit rewrites everything. It becomes a
read-only line in the history section. The add form keeps it, labelled "First occurrence."
`endDate` stays editable, since stopping a series is a genuine forward-looking edit.

**History section**, collapsed by default, versions newest first:

```
Since Sep 5, 2026      $2,450/mo on the 10th      [revert]
Jan 1 - Sep 4, 2026    $2,300/mo on the 5th
```

`revert` deletes the newest version - the escape hatch for versioning when a correction
was meant. Deleting the only version is not offered; deleting the rule covers that.

## Actions

`updateRecurringAction` takes a mode discriminator:

- `{ mode: "forward", effectiveFrom }` - creates a new version.
- `{ mode: "correct" }` - updates the version in force today. When the newest version is
  future-dated (the user scheduled a change, then spotted a typo), a correction edits that
  newest version, not the one currently in force - the typo is in the row they were just
  looking at.

Rejected with a `UserError`:

- an `effectiveFrom` that already has a version (the UI offers to replace it)
- an `effectiveFrom` earlier than the rule's `startDate`

`deleteRecurringVersionAction(ruleId, versionId)` backs `revert`, and refuses to delete a
rule's last remaining version.

## Testing

Unit tests on `expandVersioned` carry the weight:

- a date on a version boundary belongs to the newer version, and appears once
- an amount change mid-series returns the old amount for earlier dates
- the 5th-to-10th move, at both a mid-month effective date (two September charges) and a
  next-occurrence effective date (one)
- a version whose `endDate` falls before the next version's `effectiveFrom` leaves a gap
- a single-version rule produces output identical to `expandOccurrences`

Beyond that:

- an action test that a forward edit leaves past virtual occurrences unchanged while a
  correction changes them
- a calendar integration test that a past month renders the old amount
- a `plaid-sync` test that a transaction dated before a version boundary matches on the
  old amount

`src/lib/recurrence.test.ts` must pass unchanged.
