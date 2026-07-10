# Notification Center — Design

Date: 2026-07-09
Status: Approved

## Summary

Replace the single hardcoded alert digest (the "Notifications" section in Settings,
backed by the `AlertConfig` model) with a rule-based notification center: a new
sidebar page where the user defines fine-grained notification rules, each pairing a
trigger (Plaid reauth needed, budget exceeded, large transaction, ...) with an
optional Discord webhook channel and an optional custom message template with
variables. Every fired rule also lands in an in-app inbox with an unread badge.

## Decisions made during design

- **Full replacement**: `AlertConfig` and `src/lib/alerts/` are removed. The old
  scheduled digest survives as one trigger type ("scheduled digest") in the new
  system. The migration drops the `AlertConfig` table; the user recreates their
  digest as a rule.
- **Channels**: Discord webhook only in v1. ntfy and generic webhook delivery are
  dropped entirely (explicit user call). The channel layer keeps a `kind` field so
  Telegram/Slack/ntfy can return later as one module each.
- **Page scope**: rules management + fired-notification history + in-app inbox with
  a sidebar unread badge.
- **Evaluation**: hybrid. Event-driven where hook points exist (Plaid sync
  completion, CSV import), periodic sweep on the existing in-process node-cron
  pattern for time-based triggers.
- **v1 trigger groups**: connection health, budgets, bills & recurring,
  transactions & balances, plus the scheduled digest.

## Data model

All three models are per-user (single-user app; rows scoped by `userId` with
cascade delete), added to `prisma/schema.prisma`. `AlertConfig` and its `User`
relation field are deleted.

### NotificationChannel

A named Discord webhook, defined once and referenced by many rules.

- `id` cuid, `userId` (unique-per-name not required)
- `name` — user label, e.g. "budget-alerts"
- `kind` — `"discord"` (only value in v1)
- `webhookUrl` — validated on save: https, host `discord.com` or
  `discordapp.com`, path starts `/api/webhooks/`

### NotificationRule

- `id`, `userId`, `name`, `enabled` (default true)
- `trigger` — string enum, one of the trigger ids below
- `params` — JSON string; shape defined per trigger (thresholds, day counts,
  category/account filters). Validated server-side against the trigger's schema.
- `channelId` — nullable FK to NotificationChannel (`onDelete: SetNull`); null =
  in-app only
- `templateTitle`, `templateBody` — nullable; when null the trigger's default
  template is used. Support `{{variable}}` substitution.

### Notification

The fired log, doubling as the in-app inbox.

- `id`, `userId`, `ruleId` (nullable FK, `onDelete: SetNull` so history survives
  rule deletion), `ruleName` (denormalized for display after rule deletion)
- `title`, `body` — rendered text as sent
- `dedupeKey` — string; unique compound index on `(ruleId, dedupeKey)`
- `firedAt`, `readAt` (nullable)
- `deliveryStatus` — `"in_app"` (no channel) | `"sent"` | `"failed"`
- `deliveryError` — nullable

Dedupe is the anti-spam mechanism: each trigger evaluator emits a dedupe key
encoding entity + period (e.g. `budget-exceeded:groceries:2026-07`,
`plaid-reauth:item_abc:2026-07-09`). Insertion is skip-on-conflict, so a sweep
re-evaluating the same true condition does not refire. Time-window keys (daily
for connection health, monthly for budgets) double as the re-reminder cadence.

## Engine — `src/lib/notifications/`

Replaces `src/lib/alerts/` (digest.ts, run.ts, scheduler.ts, send.ts all deleted,
along with `src/actions/alerts.ts`).

### `triggers/` — one module per trigger

Each trigger module exports a `TriggerDef`:

- `id`, `label`, `group` (for UI grouping), `mode`: `"sweep"` | `"event"` | both
- `paramsSchema` — zod-style validation + the field definitions the rule editor
  renders dynamically
- `variables` — the template variables this trigger provides, with descriptions
  (rendered as clickable chips in the template editor)
- `defaultTemplate` — `{ title, body }` using those variables
- `severity` — maps to Discord embed color
- `evaluate(ctx)` — returns `TriggerEvent[]`: `{ dedupeKey, vars }`. `ctx`
  carries `userId`, parsed params, prisma, todayISO, and for event-mode
  invocations the event payload (e.g. new transaction ids from a sync).

A registry (`triggers/index.ts`) maps id → def; the UI and engine both read it.
Adding a future trigger = one new file + registry entry.

### v1 trigger catalog

| id | Group | Mode | Params | Key variables |
|---|---|---|---|---|
| `plaid-reauth` | Connection | event + sweep | — | `{{account}}`, `{{institution}}` |
| `sync-failing` | Connection | event | consecutive failures N | `{{account}}`, `{{failures}}` |
| `account-stale` | Connection | sweep | days without sync | `{{account}}`, `{{days}}` |
| `budget-exceeded` | Budgets | sweep + event | optional category filter | `{{category}}`, `{{spent}}`, `{{budget}}`, `{{over}}` |
| `budget-threshold` | Budgets | sweep + event | percent, optional category filter | `{{category}}`, `{{percent}}`, `{{spent}}`, `{{budget}}` |
| `budget-pace` | Budgets | sweep | — (projected overspend at current rate) | `{{category}}`, `{{projected}}`, `{{budget}}` |
| `bill-due` | Bills | sweep | days ahead | `{{name}}`, `{{amount}}`, `{{due_date}}`, `{{days}}` |
| `cc-due` | Bills | sweep | days ahead | `{{account}}`, `{{amount}}`, `{{due_date}}`, `{{days}}` |
| `recurring-price-change` | Bills | event | min % or $ change | `{{name}}`, `{{old_amount}}`, `{{new_amount}}`, `{{change}}` |
| `recurring-missing` | Bills | sweep | grace days | `{{name}}`, `{{expected_date}}`, `{{days_late}}` |
| `large-transaction` | Transactions | event | $ threshold, optional account filter | `{{merchant}}`, `{{amount}}`, `{{account}}`, `{{category}}` |
| `new-merchant` | Transactions | event | optional account filter | `{{merchant}}`, `{{amount}}`, `{{account}}` |
| `low-balance` | Balances | sweep + event | $ threshold, account | `{{account}}`, `{{balance}}`, `{{threshold}}` |
| `cc-utilization` | Balances | sweep + event | percent, account | `{{account}}`, `{{percent}}`, `{{balance}}`, `{{limit}}` |
| `income-received` | Transactions | event | optional account filter, min $ | `{{merchant}}`, `{{amount}}`, `{{account}}` |
| `digest` | Digest | sweep | frequency (daily/weekly + weekday), hour, look-ahead days | `{{summary}}` (pre-rendered digest body) |

Evaluators reuse existing query/domain code where it exists (`lib/queries`,
`recurrence.ts`, budget math, the old digest builder's logic for the `digest`
trigger) rather than duplicating it.

### `engine.ts`

`runRules(userId, opts)` where opts selects mode (`sweep` vs a named event with
payload) and optionally a single rule id (the "Send test" path):

1. Load enabled rules matching the mode (test path forces one rule, bypasses
   dedupe with a `test:` prefixed key).
2. For each rule: `evaluate()` → for each event, render template (custom or
   default) via `{{var}}` substitution (unknown variables render literally),
   insert `Notification` skipping dedupe conflicts, then deliver to the rule's
   channel if set.
3. Delivery failure never blocks the inbox row — it's recorded as
   `deliveryStatus: "failed"` + `deliveryError`. No auto-retry in v1.
4. Errors in one rule's evaluation are caught and logged; other rules still run.

### `discord.ts`

POST an embed to the webhook (title, description = body, color by trigger
severity, timestamp, footer "Moolah"), 10s `AbortSignal.timeout`, non-2xx throws
with status text.

### `scheduler.ts` + hooks

- Global sweep task via node-cron **every 15 minutes**, booted from
  `src/instrumentation.ts` (replacing the alerts scheduler boot), no-op on
  serverless — same pattern as the backup scheduler. Each sweep runs sweep-mode
  rules for every user with enabled rules.
- The `digest` trigger self-gates inside `evaluate()`: it computes the most
  recent scheduled slot from its frequency/hour params and emits only when
  now ≥ slot, with the slot date in the dedupe key — so it fires once, on the
  first sweep past its scheduled time.
- **Event hooks**: at the end of a Plaid sync (`lib/plaid-sync.ts`), run
  event-mode rules with the sync outcome (reauth flag, failure streak, new
  transaction ids, updated balances). After a CSV import commit, run
  transaction-scoped event rules with the imported transaction ids.

## API / server actions — `src/actions/notifications.ts`

- Channel CRUD (create/update/delete) with webhook URL validation
- Rule CRUD with per-trigger param validation against the registry
- `testRuleAction(ruleId)` — evaluates just that rule with dedupe bypassed; if
  the condition isn't currently true, sends a synthetic sample event using
  placeholder variable values so delivery + template can be verified
- `markReadAction(ids | all)`
- Inbox listing is a server-component query (paginated, newest first)
- Unread count exposed for the sidebar badge

All actions follow the existing `action-result.ts` pattern and demo-guard rules.

## UI

- **Sidebar** ([app-nav.ts](../../src/components/app-nav.ts) /
  [Sidebar.tsx](../../src/components/Sidebar.tsx)): new "Notifications" item with
  a bell icon and an unread-count badge (hidden at 0). Badge count comes from the
  layout's server render; marking read updates it via router refresh.
- **`/notifications` page** (`src/app/(app)/notifications/`): two tabs.
  - **Inbox**: notification list (title, body, rule name, time, delivery status —
    failed deliveries show the error), unread styling, mark-read on click,
    mark-all-read button.
  - **Rules**: rule cards grouped by trigger group, enable/disable toggle,
    edit/delete, "Send test" per rule; "Add rule" opens the editor. A compact
    "Channels" section manages named Discord webhooks.
- **Rule editor** (modal or inline panel, matching existing app patterns):
  trigger picker (grouped) → dynamic param fields from the trigger's schema →
  channel select (named channels + "In-app only") → collapsible "Custom message"
  with title/body inputs and clickable variable chips inserting `{{var}}` →
  save/test.
- **Settings page**: the "Notifications" section and `AlertsForm.tsx` are
  removed. Docs/README references to ntfy alerts updated.
- Monochrome palette per the July 2026 redesign; no green/paper.

## Migration & cleanup

- Prisma migration: create the three new tables, drop `AlertConfig`.
- Delete `src/lib/alerts/` and `src/actions/alerts.ts`; remove the alerts boot
  from `instrumentation.ts` (replaced by the notifications scheduler boot).
- No data migration: old configs can't map to Discord-only channels. Loss
  acknowledged and accepted; README/docs updated to describe the new system.

## Error handling

- Invalid webhook URL rejected at save time.
- Discord delivery failure: inbox row still created, status "failed" + error
  shown in the inbox; no retry.
- One trigger's evaluation error is logged and skipped; sweep continues.
- Template rendering never throws: unknown `{{vars}}` pass through literally.
- Rules referencing a deleted channel fall back to in-app only (`SetNull`).

## Testing

Vitest, colocated `*.test.ts` per the existing convention:

- Each trigger evaluator: fires when condition true, silent when false, correct
  dedupe keys and variables (prisma mocked as in existing lib tests).
- Template rendering: substitution, unknown vars, default fallback.
- Engine: dedupe skip, delivery-failure-still-inserts, per-rule error isolation,
  test-mode synthetic events.
- Discord payload shape + URL validation.
- Digest trigger slot-gating math (daily/weekly, hour boundaries).
