# Notification Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the hardcoded AlertConfig digest with a rule-based notification center: per-user rules pairing 16 trigger types with an optional Discord webhook channel and custom message templates, plus an in-app inbox with a sidebar unread badge.

**Architecture:** A trigger registry (`src/lib/notifications/triggers/`, one module per trigger) feeds an engine (`runRules`) that evaluates rules, dedupes via a unique `(ruleId, dedupeKey)` index, writes inbox rows, and delivers to Discord. Evaluation is hybrid: a 15-minute node-cron sweep booted from `instrumentation.ts` plus event hooks in Plaid sync and CSV import. UI is a new `/notifications` page (Inbox + Rules tabs) and a bell nav item with an unread badge.

**Tech Stack:** Next.js App Router, Prisma (postgres, client generated to `src/generated/prisma`), zod, node-cron, vitest, Tailwind (existing token classes).

**Spec:** `docs/superpowers/specs/2026-07-09-notification-center-design.md`

## Global Constraints

- Monochrome palette per the July 2026 redesign — use existing token classes (`text-muted`, `bg-surface2`, `bg-brand/10`, `text-brand`, `border-line`, `btn-ghost`, `btn-primary`, `card`). Never reintroduce green/paper colors.
- Human-written style: hyphens not em-dashes, no over-commenting, no vague names. Comments only for constraints the code can't show.
- Channels are Discord-only in v1 (explicit user decision). Keep the `kind` field on NotificationChannel for future expansion; do not add ntfy/generic webhook code.
- Full replacement: the AlertConfig model, `src/lib/alerts/`, `src/actions/alerts.ts`, and the settings Notifications section are deleted. No data migration.
- `src/app/(app)/SpendingAlertsCard.tsx` and the dashboard "spending alerts" feature are UNRELATED (anomaly detection). Do not touch them.
- All server actions: `"use server"`, `isDemoMode()` early return `{ ok: true }`, `run()`/`UserError` from `src/lib/action-result.ts`, `requireUser()` from `src/lib/session.ts`, `revalidatePath` after writes.
- Tests: vitest, colocated `*.test.ts`. Run with `npx vitest run <path>`. Full suite: `npm test`.
- Prisma mock pattern (see `src/lib/calendar.async.test.ts`): `vi.mock("@/lib/prisma", () => ({ prisma: { ... } }))` then `vi.mocked(...)`.
- Money display via `formatUSD` from `src/lib/money.ts`; Decimal-to-number via `toNumber`.
- Dates: `todayISO` strings are `YYYY-MM-DD`; UTC-midnight helpers `parseISODay`/`isoDay`/`addUTCDays` from `src/lib/dates.ts`.

## File map

Create:
- `src/lib/notifications/types.ts` — shared trigger/engine types
- `src/lib/notifications/render.ts` (+ test) — `{{var}}` template substitution
- `src/lib/notifications/discord.ts` (+ test) — webhook URL validation + embed delivery
- `src/lib/notifications/triggers/` — 16 trigger modules + `index.ts` registry (+ tests)
- `src/lib/notifications/engine.ts` (+ test) — `runRules`
- `src/lib/notifications/scheduler.ts` (+ test) — 15-min sweep
- `src/lib/queries/notifications.ts` — inbox/rules/channels queries + unread count
- `src/actions/notifications.ts` — channel/rule CRUD, test-send, mark-read
- `src/app/(app)/notifications/page.tsx`, `NotificationCenter.tsx`, `InboxList.tsx`, `RulesPanel.tsx`, `RuleEditor.tsx`, `ChannelsPanel.tsx`

Modify:
- `prisma/schema.prisma` — drop AlertConfig, add NotificationChannel/NotificationRule/Notification, add `PlaidItem.failureCount`
- `src/instrumentation.ts` — swap alert scheduler boot for notification scheduler
- `src/lib/plaid-sync.ts` — collect new txn ids, reset failureCount, fire event rules
- `src/app/api/plaid/sync/[itemId]/route.ts` — increment failureCount, fire failure event
- `src/actions/import.ts` — `createManyAndReturn`, fire event rules
- `src/components/app-nav.ts`, `src/components/Sidebar.tsx`, `src/components/AppChrome.tsx`, `src/app/(app)/layout.tsx` — nav item + unread badge
- `src/app/(app)/settings/page.tsx` — remove Notifications section
- `README.md` — replace ntfy digest docs

Delete:
- `src/lib/alerts/` (digest.ts, digest.test.ts, run.ts, scheduler.ts, send.ts)
- `src/actions/alerts.ts`
- `src/app/(app)/settings/sections/AlertsForm.tsx`

---

### Task 1: Schema migration + old alert system removal

The AlertConfig drop and the code that references `prisma.alertConfig` must go in one commit, because `prisma generate` removes the model and breaks every referencing file.

**Files:**
- Modify: `prisma/schema.prisma`
- Delete: `src/lib/alerts/digest.ts`, `src/lib/alerts/digest.test.ts`, `src/lib/alerts/run.ts`, `src/lib/alerts/scheduler.ts`, `src/lib/alerts/send.ts`, `src/actions/alerts.ts`, `src/app/(app)/settings/sections/AlertsForm.tsx`
- Modify: `src/app/(app)/settings/page.tsx`, `src/instrumentation.ts`
- Create: migration via `npx prisma migrate dev`

**Interfaces:**
- Produces: Prisma models `NotificationChannel`, `NotificationRule`, `Notification` (client at `@/lib/prisma`), `PlaidItem.failureCount: number`. Later tasks use exactly these field names.

- [ ] **Step 1: Edit `prisma/schema.prisma`**

Remove the entire `model AlertConfig { ... }` block (around line 474) and the `alertConfig AlertConfig?` relation line on the User model (around line 57).

On the User model, where `alertConfig` was, add:

```prisma
  notificationChannels NotificationChannel[]
  notificationRules    NotificationRule[]
  notifications        Notification[]
```

On the PlaidItem model (line ~385), after the `error String?` field, add:

```prisma
  failureCount    Int       @default(0)
```

At the end of the file (where AlertConfig was), add:

```prisma
/// A named Discord webhook, defined once and referenced by many rules.
/// `kind` is always "discord" in v1; kept so other channel types can be
/// added later without a migration.
model NotificationChannel {
  id         String   @id @default(cuid())
  userId     String
  user       User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name       String
  kind       String   @default("discord")
  webhookUrl String
  createdAt  DateTime @default(now())
  updatedAt  DateTime @updatedAt

  rules NotificationRule[]

  @@index([userId])
}

model NotificationRule {
  id            String   @id @default(cuid())
  userId        String
  user          User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  name          String
  enabled       Boolean  @default(true)
  /// Trigger id from the registry (src/lib/notifications/triggers).
  trigger       String
  /// JSON string; shape validated against the trigger's zod schema.
  params        String   @default("{}")
  /// Null = in-app only. SetNull so deleting a channel downgrades rules
  /// instead of deleting them.
  channelId     String?
  channel       NotificationChannel? @relation(fields: [channelId], references: [id], onDelete: SetNull)
  templateTitle String?
  templateBody  String?
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt

  notifications Notification[]

  @@index([userId])
}

/// Fired-notification log, doubling as the in-app inbox. Survives rule
/// deletion via SetNull + the denormalized ruleName.
model Notification {
  id             String    @id @default(cuid())
  userId         String
  user           User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  ruleId         String?
  rule           NotificationRule? @relation(fields: [ruleId], references: [id], onDelete: SetNull)
  ruleName       String
  title          String
  body           String
  dedupeKey      String
  firedAt        DateTime  @default(now())
  readAt         DateTime?
  /// "in_app" (no channel) | "sent" | "failed"
  deliveryStatus String    @default("in_app")
  deliveryError  String?

  @@unique([ruleId, dedupeKey])
  @@index([userId, firedAt])
  @@index([userId, readAt])
}
```

- [ ] **Step 2: Delete the old alert system**

```bash
git rm -r src/lib/alerts
git rm src/actions/alerts.ts "src/app/(app)/settings/sections/AlertsForm.tsx"
```

- [ ] **Step 3: Remove the settings Notifications section**

In `src/app/(app)/settings/page.tsx`:

1. Delete the import line: `import { AlertsForm } from "./sections/AlertsForm";`
2. Delete the `alertConfig` fetch and `alertProps` block (the lines from `const alertConfig = await prisma.alertConfig.findUnique({ where: { userId } });` through the closing `};` of `alertProps` — currently lines ~69-80).
3. Delete the entire Notifications `<section>` (the `<section className="card p-5">` containing `<h2 ...>Notifications</h2>` and `<AlertsForm config={alertProps} />` — currently lines ~147-155).

Keep the `scheduleFromCron` import — the backup section still uses it.

- [ ] **Step 4: Swap the instrumentation boot**

In `src/instrumentation.ts`, replace:

```ts
  const { startAlertScheduler } = await import("@/lib/alerts/scheduler");
  await startAlertScheduler();
```

with:

```ts
  const { startNotificationScheduler } = await import("@/lib/notifications/scheduler");
  await startNotificationScheduler();
```

(The scheduler module doesn't exist yet — create a stub so the build passes:)

Create `src/lib/notifications/scheduler.ts`:

```ts
// Replaced with the real sweep in the scheduler task.
export async function startNotificationScheduler(): Promise<void> {}
```

- [ ] **Step 5: Run the migration**

```bash
npx prisma migrate dev --name notification_center
```

Expected: migration created under `prisma/migrations/`, `prisma generate` succeeds. The generated SQL drops `AlertConfig`, creates the three tables, and adds `failureCount` to `PlaidItem`.

- [ ] **Step 6: Verify build and tests**

```bash
npx tsc --noEmit && npm test
```

Expected: PASS (the deleted digest.test.ts no longer runs; nothing references `prisma.alertConfig`).

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat: replace AlertConfig with notification center schema"
```

---

### Task 2: Template renderer

**Files:**
- Create: `src/lib/notifications/render.ts`
- Test: `src/lib/notifications/render.test.ts`

**Interfaces:**
- Produces: `renderTemplate(template: string, vars: Record<string, string>): string` — substitutes `{{name}}`, unknown vars pass through literally, never throws.

- [ ] **Step 1: Write the failing test**

`src/lib/notifications/render.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { renderTemplate } from "./render";

describe("renderTemplate", () => {
  it("substitutes known variables", () => {
    expect(renderTemplate("{{category}} is {{spent}} over", { category: "Groceries", spent: "$42.00" }))
      .toBe("Groceries is $42.00 over");
  });

  it("leaves unknown variables literal", () => {
    expect(renderTemplate("hello {{nope}}", { category: "x" })).toBe("hello {{nope}}");
  });

  it("substitutes repeated variables", () => {
    expect(renderTemplate("{{a}} and {{a}}", { a: "1" })).toBe("1 and 1");
  });

  it("returns plain text untouched", () => {
    expect(renderTemplate("no vars here", {})).toBe("no vars here");
  });

  it("renders an empty-string variable", () => {
    expect(renderTemplate("[{{a}}]", { a: "" })).toBe("[]");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/notifications/render.test.ts`
Expected: FAIL — cannot find module `./render`.

- [ ] **Step 3: Implement**

`src/lib/notifications/render.ts`:

```ts
/** Substitute {{name}} placeholders. Unknown variables render literally so a
 *  typo in a custom template degrades visibly instead of throwing. */
export function renderTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, name: string) => vars[name] ?? match);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/notifications/render.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/render.ts src/lib/notifications/render.test.ts
git commit -m "feat: notification template renderer"
```

---

### Task 3: Trigger types + registry skeleton

**Files:**
- Create: `src/lib/notifications/types.ts`
- Create: `src/lib/notifications/triggers/index.ts`

**Interfaces:**
- Produces (used by every later task):
  - `TriggerDef`, `TriggerContext`, `TriggerEvent`, `NotificationEventPayload`, `ParamField`, `Severity`, `TriggerGroup`, `TriggerMode` from `@/lib/notifications/types`
  - `TRIGGERS: TriggerDef[]`, `TRIGGER_BY_ID: Map<string, TriggerDef>`, `TRIGGER_GROUPS` from `@/lib/notifications/triggers`

- [ ] **Step 1: Create `src/lib/notifications/types.ts`**

```ts
import type { z } from "zod";

export type TriggerGroup = "connection" | "budgets" | "bills" | "transactions" | "digest";
export type TriggerMode = "sweep" | "event";
export type Severity = "info" | "warning" | "critical";

/** Drives the dynamic param inputs in the rule editor. */
export interface ParamField {
  key: string;
  label: string;
  kind: "number" | "select";
  min?: number;
  max?: number;
  step?: number;
  /** Editor populates options from the user's accounts or categories. */
  optionsFrom?: "account" | "category";
  options?: { value: string; label: string }[];
  optional?: boolean;
  help?: string;
}

export interface TriggerVariable {
  name: string;
  description: string;
}

/** One firing produced by a trigger's evaluate(). */
export interface TriggerEvent {
  /** Encodes entity + period; unique per (ruleId, dedupeKey) so re-evaluating
   *  the same true condition doesn't refire. */
  dedupeKey: string;
  vars: Record<string, string>;
}

export interface NotificationEventPayload {
  kind: "plaid-sync" | "plaid-sync-failed" | "csv-import";
  plaidItemId?: string;
  reauthRequired?: boolean;
  failureCount?: number;
  newTransactionIds: string[];
}

export interface TriggerContext {
  userId: string;
  /** Already validated against the trigger's paramsSchema. */
  params: Record<string, unknown>;
  todayISO: string;
  now: Date;
  /** Present only for event-mode invocations. */
  event?: NotificationEventPayload;
}

export interface TriggerDef {
  id: string;
  label: string;
  description: string;
  group: TriggerGroup;
  modes: TriggerMode[];
  severity: Severity;
  paramsSchema: z.ZodTypeAny;
  paramFields: ParamField[];
  variables: TriggerVariable[];
  defaultTemplate: { title: string; body: string };
  /** Placeholder values for "Send test" when the condition isn't currently true. */
  sampleVars: Record<string, string>;
  evaluate(ctx: TriggerContext): Promise<TriggerEvent[]>;
}
```

- [ ] **Step 2: Create `src/lib/notifications/triggers/index.ts`**

```ts
import type { TriggerDef, TriggerGroup } from "../types";

export const TRIGGERS: TriggerDef[] = [];

export const TRIGGER_BY_ID = new Map(TRIGGERS.map((t) => [t.id, t]));

export const TRIGGER_GROUPS: { id: TriggerGroup; label: string }[] = [
  { id: "connection", label: "Connection health" },
  { id: "budgets", label: "Budgets" },
  { id: "bills", label: "Bills & recurring" },
  { id: "transactions", label: "Transactions & balances" },
  { id: "digest", label: "Digest" },
];
```

(Each trigger task appends its imports and array entries; `TRIGGER_BY_ID` derives automatically.)

- [ ] **Step 3: Typecheck and commit**

```bash
npx tsc --noEmit
git add src/lib/notifications/types.ts src/lib/notifications/triggers/index.ts
git commit -m "feat: notification trigger types and registry skeleton"
```

---

### Task 4: Discord delivery

**Files:**
- Create: `src/lib/notifications/discord.ts`
- Test: `src/lib/notifications/discord.test.ts`

**Interfaces:**
- Produces:
  - `isValidDiscordWebhookUrl(raw: string): boolean`
  - `sendDiscord(webhookUrl: string, message: { title: string; body: string; severity: Severity }): Promise<void>` — throws on non-2xx or timeout (10s).

- [ ] **Step 1: Write the failing test**

`src/lib/notifications/discord.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { isValidDiscordWebhookUrl, sendDiscord } from "./discord";

describe("isValidDiscordWebhookUrl", () => {
  it("accepts discord.com and discordapp.com webhook URLs", () => {
    expect(isValidDiscordWebhookUrl("https://discord.com/api/webhooks/123/abc")).toBe(true);
    expect(isValidDiscordWebhookUrl("https://discordapp.com/api/webhooks/123/abc")).toBe(true);
  });

  it("rejects http, other hosts, other paths, and garbage", () => {
    expect(isValidDiscordWebhookUrl("http://discord.com/api/webhooks/123/abc")).toBe(false);
    expect(isValidDiscordWebhookUrl("https://evil.com/api/webhooks/123/abc")).toBe(false);
    expect(isValidDiscordWebhookUrl("https://discord.com/channels/123")).toBe(false);
    expect(isValidDiscordWebhookUrl("not a url")).toBe(false);
    expect(isValidDiscordWebhookUrl("https://notdiscord.com/api/webhooks/x")).toBe(false);
  });
});

describe("sendDiscord", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts an embed with title, body, severity color, and Moolah footer", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));
    await sendDiscord("https://discord.com/api/webhooks/1/t", {
      title: "Over budget",
      body: "Groceries is $12 over",
      severity: "warning",
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://discord.com/api/webhooks/1/t");
    const payload = JSON.parse(init!.body as string);
    expect(payload.embeds).toHaveLength(1);
    expect(payload.embeds[0].title).toBe("Over budget");
    expect(payload.embeds[0].description).toBe("Groceries is $12 over");
    expect(payload.embeds[0].footer).toEqual({ text: "Moolah" });
    expect(typeof payload.embeds[0].color).toBe("number");
    expect(typeof payload.embeds[0].timestamp).toBe("string");
  });

  it("throws on non-2xx with the status in the message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 404, statusText: "Not Found" }));
    await expect(
      sendDiscord("https://discord.com/api/webhooks/1/t", { title: "t", body: "b", severity: "info" }),
    ).rejects.toThrow(/404/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/notifications/discord.test.ts`
Expected: FAIL — cannot find module `./discord`.

- [ ] **Step 3: Implement**

`src/lib/notifications/discord.ts`:

```ts
import type { Severity } from "./types";

const SEVERITY_COLORS: Record<Severity, number> = {
  info: 0x8a8f98,
  warning: 0xe8a33d,
  critical: 0xd64545,
};

export function isValidDiscordWebhookUrl(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  if (host !== "discord.com" && host !== "discordapp.com") return false;
  return url.pathname.startsWith("/api/webhooks/");
}

export async function sendDiscord(
  webhookUrl: string,
  message: { title: string; body: string; severity: Severity },
): Promise<void> {
  const res = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      embeds: [
        {
          title: message.title,
          description: message.body,
          color: SEVERITY_COLORS[message.severity],
          timestamp: new Date().toISOString(),
          footer: { text: "Moolah" },
        },
      ],
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Discord webhook failed: ${res.status} ${res.statusText}`);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/notifications/discord.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/discord.ts src/lib/notifications/discord.test.ts
git commit -m "feat: discord webhook delivery and URL validation"
```

---

### Task 5: Connection health triggers

**Files:**
- Create: `src/lib/notifications/triggers/plaid-reauth.ts`, `sync-failing.ts`, `account-stale.ts`
- Modify: `src/lib/notifications/triggers/index.ts`
- Test: `src/lib/notifications/triggers/connection.test.ts`

**Interfaces:**
- Consumes: `TriggerDef`/`TriggerContext` from Task 3; `prisma.plaidItem` (fields `id`, `userId`, `institutionName`, `error`, `failureCount`, `lastSyncedAt` from Task 1).
- Produces: registry entries `plaid-reauth`, `sync-failing`, `account-stale`. Dedupe keys: `plaid-reauth:<itemId>:<todayISO>`, `sync-failing:<itemId>:<todayISO>`, `account-stale:<itemId>:<todayISO>` (daily re-remind cadence).

- [ ] **Step 1: Write the failing tests**

`src/lib/notifications/triggers/connection.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TriggerContext } from "../types";
import { plaidReauth } from "./plaid-reauth";
import { syncFailing } from "./sync-failing";
import { accountStale } from "./account-stale";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    plaidItem: { findMany: vi.fn(), findUnique: vi.fn() },
  },
}));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1",
  params: {},
  todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("plaid-reauth", () => {
  it("fires per item needing reauth with a daily dedupe key", async () => {
    vi.mocked(prisma.plaidItem.findMany).mockResolvedValue([
      { id: "it1", institutionName: "Chase" },
    ] as never);
    const events = await plaidReauth.evaluate(ctx());
    expect(events).toEqual([
      { dedupeKey: "plaid-reauth:it1:2026-07-09", vars: { institution: "Chase" } },
    ]);
  });

  it("is silent when no item has a reauth error", async () => {
    vi.mocked(prisma.plaidItem.findMany).mockResolvedValue([] as never);
    expect(await plaidReauth.evaluate(ctx())).toEqual([]);
  });
});

describe("sync-failing", () => {
  const failEvent = (failureCount: number, reauthRequired = false) => ({
    kind: "plaid-sync-failed" as const,
    plaidItemId: "it1",
    reauthRequired,
    failureCount,
    newTransactionIds: [],
  });

  it("fires when the failure streak reaches the threshold", async () => {
    vi.mocked(prisma.plaidItem.findUnique).mockResolvedValue(
      { institutionName: "Chase", error: "RATE_LIMIT" } as never,
    );
    const events = await syncFailing.evaluate(ctx({ params: { failures: 3 }, event: failEvent(3) }));
    expect(events).toEqual([
      {
        dedupeKey: "sync-failing:it1:2026-07-09",
        vars: { institution: "Chase", failures: "3", error: "RATE_LIMIT" },
      },
    ]);
  });

  it("is silent below the threshold", async () => {
    expect(await syncFailing.evaluate(ctx({ params: { failures: 3 }, event: failEvent(2) }))).toEqual([]);
  });

  it("is silent for reauth failures (plaid-reauth owns those)", async () => {
    expect(await syncFailing.evaluate(ctx({ params: { failures: 1 }, event: failEvent(5, true) }))).toEqual([]);
  });

  it("is silent without an event payload", async () => {
    expect(await syncFailing.evaluate(ctx({ params: { failures: 3 } }))).toEqual([]);
  });
});

describe("account-stale", () => {
  it("fires when lastSyncedAt is older than the threshold", async () => {
    vi.mocked(prisma.plaidItem.findMany).mockResolvedValue([
      { id: "it1", institutionName: "Chase", lastSyncedAt: new Date("2026-07-04T12:00:00Z") },
    ] as never);
    const events = await accountStale.evaluate(ctx({ params: { days: 3 } }));
    expect(events).toEqual([
      { dedupeKey: "account-stale:it1:2026-07-09", vars: { institution: "Chase", days: "5" } },
    ]);
  });

  it("skips fresh items and never-synced items", async () => {
    vi.mocked(prisma.plaidItem.findMany).mockResolvedValue([
      { id: "it1", institutionName: "Chase", lastSyncedAt: new Date("2026-07-08T12:00:00Z") },
      { id: "it2", institutionName: "Ally", lastSyncedAt: null },
    ] as never);
    expect(await accountStale.evaluate(ctx({ params: { days: 3 } }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/notifications/triggers/connection.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three triggers**

`src/lib/notifications/triggers/plaid-reauth.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { TriggerDef } from "../types";

export const plaidReauth: TriggerDef = {
  id: "plaid-reauth",
  label: "Bank connection needs re-authorization",
  description: "A Plaid connection returned ITEM_LOGIN_REQUIRED and must be relinked.",
  group: "connection",
  modes: ["sweep", "event"],
  severity: "critical",
  paramsSchema: z.object({}),
  paramFields: [],
  variables: [{ name: "institution", description: "Institution name" }],
  defaultTemplate: {
    title: "{{institution}} needs re-authorization",
    body: "The connection to {{institution}} lost access. Relink it from the Accounts page.",
  },
  sampleVars: { institution: "Sample Bank" },
  async evaluate(ctx) {
    const items = await prisma.plaidItem.findMany({
      where: { userId: ctx.userId, error: { contains: "ITEM_LOGIN_REQUIRED" } },
      select: { id: true, institutionName: true },
    });
    return items.map((item) => ({
      dedupeKey: `plaid-reauth:${item.id}:${ctx.todayISO}`,
      vars: { institution: item.institutionName ?? "Bank connection" },
    }));
  },
};
```

`src/lib/notifications/triggers/sync-failing.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { TriggerDef } from "../types";

export const syncFailing: TriggerDef = {
  id: "sync-failing",
  label: "Sync keeps failing",
  description: "A bank connection has failed to sync several times in a row.",
  group: "connection",
  modes: ["event"],
  severity: "warning",
  paramsSchema: z.object({
    failures: z.number().int().min(1).max(20).default(3),
  }),
  paramFields: [
    { key: "failures", label: "Consecutive failures", kind: "number", min: 1, max: 20 },
  ],
  variables: [
    { name: "institution", description: "Institution name" },
    { name: "failures", description: "Consecutive failure count" },
    { name: "error", description: "Last sync error message" },
  ],
  defaultTemplate: {
    title: "{{institution}} sync failing",
    body: "{{institution}} has failed to sync {{failures}} times in a row. Last error: {{error}}",
  },
  sampleVars: { institution: "Sample Bank", failures: "3", error: "RATE_LIMIT_EXCEEDED" },
  async evaluate(ctx) {
    const { failures } = ctx.params as { failures: number };
    const event = ctx.event;
    if (!event || event.kind !== "plaid-sync-failed" || !event.plaidItemId) return [];
    if (event.reauthRequired) return []; // plaid-reauth owns login failures
    if ((event.failureCount ?? 0) < failures) return [];
    const item = await prisma.plaidItem.findUnique({
      where: { id: event.plaidItemId },
      select: { institutionName: true, error: true },
    });
    if (!item) return [];
    return [
      {
        dedupeKey: `sync-failing:${event.plaidItemId}:${ctx.todayISO}`,
        vars: {
          institution: item.institutionName ?? "Bank connection",
          failures: String(event.failureCount),
          error: item.error ?? "",
        },
      },
    ];
  },
};
```

`src/lib/notifications/triggers/account-stale.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { TriggerDef } from "../types";

const DAY_MS = 86_400_000;

export const accountStale: TriggerDef = {
  id: "account-stale",
  label: "Connection hasn't synced in a while",
  description: "A bank connection hasn't successfully synced for N days.",
  group: "connection",
  modes: ["sweep"],
  severity: "warning",
  paramsSchema: z.object({
    days: z.number().int().min(1).max(60).default(3),
  }),
  paramFields: [{ key: "days", label: "Days without a sync", kind: "number", min: 1, max: 60 }],
  variables: [
    { name: "institution", description: "Institution name" },
    { name: "days", description: "Days since the last successful sync" },
  ],
  defaultTemplate: {
    title: "{{institution}} hasn't synced in {{days}} days",
    body: "The last successful sync for {{institution}} was {{days}} days ago.",
  },
  sampleVars: { institution: "Sample Bank", days: "4" },
  async evaluate(ctx) {
    const { days } = ctx.params as { days: number };
    const items = await prisma.plaidItem.findMany({
      where: { userId: ctx.userId, lastSyncedAt: { not: null } },
      select: { id: true, institutionName: true, lastSyncedAt: true },
    });
    const events = [];
    for (const item of items) {
      const staleDays = Math.floor((ctx.now.getTime() - item.lastSyncedAt!.getTime()) / DAY_MS);
      if (staleDays < days) continue;
      events.push({
        dedupeKey: `account-stale:${item.id}:${ctx.todayISO}`,
        vars: { institution: item.institutionName ?? "Bank connection", days: String(staleDays) },
      });
    }
    return events;
  },
};
```

- [ ] **Step 4: Register the triggers**

In `src/lib/notifications/triggers/index.ts`, add imports and array entries:

```ts
import { plaidReauth } from "./plaid-reauth";
import { syncFailing } from "./sync-failing";
import { accountStale } from "./account-stale";
```

and change the array to:

```ts
export const TRIGGERS: TriggerDef[] = [plaidReauth, syncFailing, accountStale];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/notifications/triggers/connection.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/triggers
git commit -m "feat: connection health notification triggers"
```

---

### Task 6: Budget triggers

**Files:**
- Create: `src/lib/notifications/triggers/budget-exceeded.ts`, `budget-threshold.ts`, `budget-pace.ts`
- Modify: `src/lib/notifications/triggers/index.ts`
- Test: `src/lib/notifications/triggers/budgets.test.ts`

**Interfaces:**
- Consumes: `getBudgetMonth(userId, monthISO): Promise<BudgetLineDTO[]>` from `@/lib/queries/budgets` (`BudgetLineDTO = { categoryId, name, color, icon, limit, actual, rollover, carryover, effectiveLimit }`); `formatUSD` from `@/lib/money`.
- Produces: registry entries `budget-exceeded`, `budget-threshold`, `budget-pace`. Dedupe keys: `budget-exceeded:<categoryId>:<YYYY-MM>`, `budget-threshold:<categoryId>:<YYYY-MM>:<percent>`, `budget-pace:<categoryId>:<YYYY-MM>` (monthly cadence).

- [ ] **Step 1: Write the failing tests**

`src/lib/notifications/triggers/budgets.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getBudgetMonth } from "@/lib/queries/budgets";
import type { TriggerContext } from "../types";
import { budgetExceeded } from "./budget-exceeded";
import { budgetThreshold } from "./budget-threshold";
import { budgetPace } from "./budget-pace";

vi.mock("@/lib/queries/budgets", () => ({ getBudgetMonth: vi.fn() }));

const line = (over: Partial<{ categoryId: string; name: string; limit: number; actual: number; effectiveLimit: number }> = {}) => ({
  categoryId: "c1", name: "Groceries", color: "#888", icon: "cart",
  limit: 500, actual: 0, rollover: false, carryover: 0, effectiveLimit: 500,
  ...over,
});

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1",
  params: {},
  todayISO: "2026-07-15",
  now: new Date("2026-07-15T12:00:00Z"),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("budget-exceeded", () => {
  it("fires per over-budget category with a monthly dedupe key", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([
      line({ actual: 512.5 }),
      line({ categoryId: "c2", name: "Gas", actual: 100 }),
    ]);
    const events = await budgetExceeded.evaluate(ctx());
    expect(events).toEqual([
      {
        dedupeKey: "budget-exceeded:c1:2026-07",
        vars: { category: "Groceries", spent: "$512.50", budget: "$500.00", over: "$12.50" },
      },
    ]);
  });

  it("skips categories with no budget set", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([line({ limit: 0, effectiveLimit: 0, actual: 900 })]);
    expect(await budgetExceeded.evaluate(ctx())).toEqual([]);
  });

  it("honors the category filter", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([
      line({ actual: 600 }),
      line({ categoryId: "c2", name: "Gas", actual: 600 }),
    ]);
    const events = await budgetExceeded.evaluate(ctx({ params: { categoryId: "c2" } }));
    expect(events).toHaveLength(1);
    expect(events[0].vars.category).toBe("Gas");
  });
});

describe("budget-threshold", () => {
  it("fires at or above the percent with percent in the dedupe key", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([line({ actual: 400 })]);
    const events = await budgetThreshold.evaluate(ctx({ params: { percent: 80 } }));
    expect(events).toEqual([
      {
        dedupeKey: "budget-threshold:c1:2026-07:80",
        vars: { category: "Groceries", percent: "80", spent: "$400.00", budget: "$500.00" },
      },
    ]);
  });

  it("is silent below the percent", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([line({ actual: 399 })]);
    expect(await budgetThreshold.evaluate(ctx({ params: { percent: 80 } }))).toEqual([]);
  });
});

describe("budget-pace", () => {
  it("fires when the projected month-end spend exceeds the budget", async () => {
    // Day 15 of a 31-day month: 300 spent projects to 620 > 500.
    vi.mocked(getBudgetMonth).mockResolvedValue([line({ actual: 300 })]);
    const events = await budgetPace.evaluate(ctx());
    expect(events).toHaveLength(1);
    expect(events[0].dedupeKey).toBe("budget-pace:c1:2026-07");
    expect(events[0].vars.category).toBe("Groceries");
    expect(events[0].vars.budget).toBe("$500.00");
    expect(events[0].vars.projected).toBe("$620.00");
  });

  it("stays quiet in the first days of the month (too noisy to project)", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([line({ actual: 300 })]);
    expect(await budgetPace.evaluate(ctx({ todayISO: "2026-07-03" }))).toEqual([]);
  });

  it("defers to budget-exceeded once the budget is actually blown", async () => {
    vi.mocked(getBudgetMonth).mockResolvedValue([line({ actual: 501 })]);
    expect(await budgetPace.evaluate(ctx())).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/notifications/triggers/budgets.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the three triggers**

`src/lib/notifications/triggers/budget-exceeded.ts`:

```ts
import { z } from "zod";
import { getBudgetMonth } from "@/lib/queries/budgets";
import { formatUSD } from "@/lib/money";
import type { TriggerDef } from "../types";

export const budgetExceeded: TriggerDef = {
  id: "budget-exceeded",
  label: "Budget exceeded",
  description: "A category's spending went over its budget this month.",
  group: "budgets",
  modes: ["sweep", "event"],
  severity: "warning",
  paramsSchema: z.object({
    categoryId: z.string().optional(),
  }),
  paramFields: [
    { key: "categoryId", label: "Category (all if empty)", kind: "select", optionsFrom: "category", optional: true },
  ],
  variables: [
    { name: "category", description: "Category name" },
    { name: "spent", description: "Amount spent this month" },
    { name: "budget", description: "Effective budget limit" },
    { name: "over", description: "Amount over budget" },
  ],
  defaultTemplate: {
    title: "{{category}} is over budget",
    body: "{{category}}: {{spent}} spent of {{budget}} ({{over}} over).",
  },
  sampleVars: { category: "Groceries", spent: "$512.50", budget: "$500.00", over: "$12.50" },
  async evaluate(ctx) {
    const { categoryId } = ctx.params as { categoryId?: string };
    const month = ctx.todayISO.slice(0, 7);
    const lines = await getBudgetMonth(ctx.userId, ctx.todayISO);
    return lines
      .filter((l) => l.effectiveLimit > 0 && l.actual > l.effectiveLimit)
      .filter((l) => !categoryId || l.categoryId === categoryId)
      .map((l) => ({
        dedupeKey: `budget-exceeded:${l.categoryId}:${month}`,
        vars: {
          category: l.name,
          spent: formatUSD(l.actual),
          budget: formatUSD(l.effectiveLimit),
          over: formatUSD(l.actual - l.effectiveLimit),
        },
      }));
  },
};
```

`src/lib/notifications/triggers/budget-threshold.ts`:

```ts
import { z } from "zod";
import { getBudgetMonth } from "@/lib/queries/budgets";
import { formatUSD } from "@/lib/money";
import type { TriggerDef } from "../types";

export const budgetThreshold: TriggerDef = {
  id: "budget-threshold",
  label: "Approaching a budget",
  description: "A category's spending crossed a percent of its budget this month.",
  group: "budgets",
  modes: ["sweep", "event"],
  severity: "info",
  paramsSchema: z.object({
    percent: z.number().int().min(1).max(100).default(80),
    categoryId: z.string().optional(),
  }),
  paramFields: [
    { key: "percent", label: "Percent of budget", kind: "number", min: 1, max: 100 },
    { key: "categoryId", label: "Category (all if empty)", kind: "select", optionsFrom: "category", optional: true },
  ],
  variables: [
    { name: "category", description: "Category name" },
    { name: "percent", description: "Threshold percent" },
    { name: "spent", description: "Amount spent this month" },
    { name: "budget", description: "Effective budget limit" },
  ],
  defaultTemplate: {
    title: "{{category}} is at {{percent}}% of budget",
    body: "{{category}}: {{spent}} spent of {{budget}}.",
  },
  sampleVars: { category: "Groceries", percent: "80", spent: "$400.00", budget: "$500.00" },
  async evaluate(ctx) {
    const { percent, categoryId } = ctx.params as { percent: number; categoryId?: string };
    const month = ctx.todayISO.slice(0, 7);
    const lines = await getBudgetMonth(ctx.userId, ctx.todayISO);
    return lines
      .filter((l) => l.effectiveLimit > 0 && (l.actual / l.effectiveLimit) * 100 >= percent)
      .filter((l) => !categoryId || l.categoryId === categoryId)
      .map((l) => ({
        dedupeKey: `budget-threshold:${l.categoryId}:${month}:${percent}`,
        vars: {
          category: l.name,
          percent: String(percent),
          spent: formatUSD(l.actual),
          budget: formatUSD(l.effectiveLimit),
        },
      }));
  },
};
```

`src/lib/notifications/triggers/budget-pace.ts`:

```ts
import { z } from "zod";
import { getBudgetMonth } from "@/lib/queries/budgets";
import { formatUSD } from "@/lib/money";
import type { TriggerDef } from "../types";

export const budgetPace: TriggerDef = {
  id: "budget-pace",
  label: "On pace to overspend",
  description: "At the current daily rate, a category will finish the month over budget.",
  group: "budgets",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({}),
  paramFields: [],
  variables: [
    { name: "category", description: "Category name" },
    { name: "projected", description: "Projected month-end spend" },
    { name: "budget", description: "Effective budget limit" },
  ],
  defaultTemplate: {
    title: "{{category}} is on pace to overspend",
    body: "{{category}} projects to {{projected}} this month against a {{budget}} budget.",
  },
  sampleVars: { category: "Groceries", projected: "$620.00", budget: "$500.00" },
  async evaluate(ctx) {
    const day = Number(ctx.todayISO.slice(8, 10));
    if (day < 5) return []; // too little data to project
    const [year, monthNum] = ctx.todayISO.split("-").map(Number);
    const daysInMonth = new Date(Date.UTC(year, monthNum, 0)).getUTCDate();
    const month = ctx.todayISO.slice(0, 7);
    const lines = await getBudgetMonth(ctx.userId, ctx.todayISO);
    const events = [];
    for (const l of lines) {
      if (l.effectiveLimit <= 0) continue;
      if (l.actual > l.effectiveLimit) continue; // budget-exceeded owns this
      const projected = (l.actual / day) * daysInMonth;
      if (projected <= l.effectiveLimit) continue;
      events.push({
        dedupeKey: `budget-pace:${l.categoryId}:${month}`,
        vars: {
          category: l.name,
          projected: formatUSD(projected),
          budget: formatUSD(l.effectiveLimit),
        },
      });
    }
    return events;
  },
};
```

- [ ] **Step 4: Register the triggers**

In `src/lib/notifications/triggers/index.ts` add:

```ts
import { budgetExceeded } from "./budget-exceeded";
import { budgetThreshold } from "./budget-threshold";
import { budgetPace } from "./budget-pace";
```

and extend the array:

```ts
export const TRIGGERS: TriggerDef[] = [
  plaidReauth, syncFailing, accountStale,
  budgetExceeded, budgetThreshold, budgetPace,
];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/notifications/triggers/budgets.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/triggers
git commit -m "feat: budget notification triggers"
```

---

### Task 7: Bills & recurring triggers

**Files:**
- Create: `src/lib/notifications/triggers/bill-due.ts`, `cc-due.ts`, `recurring-price-change.ts`, `recurring-missing.ts`
- Modify: `src/lib/notifications/triggers/index.ts`
- Test: `src/lib/notifications/triggers/bills.test.ts`

**Interfaces:**
- Consumes: `getUpcoming(userId, todayISO, days): Promise<UpcomingItem[]>` from `@/lib/calendar` (`UpcomingItem = { date: string; description: string; amount: number; type: TxnType; categoryId: string | null; recurring: boolean }`); `expandOccurrences(rule, rangeStart, rangeEnd): Date[]` from `@/lib/recurrence`; `parseISODay`, `isoDay`, `addUTCDays` from `@/lib/dates`; `toNumber`, `formatUSD` from `@/lib/money`; `prisma.financialAccount`, `prisma.recurringRule`, `prisma.transaction`.
- Produces: registry entries `bill-due`, `cc-due`, `recurring-price-change`, `recurring-missing`. Dedupe keys: `bill-due:<description>:<date>`, `cc-due:<accountId>:<dueISO>`, `recurring-price-change:<ruleId>:<txnId>`, `recurring-missing:<ruleId>:<expectedISO>`.

- [ ] **Step 1: Write the failing tests**

`src/lib/notifications/triggers/bills.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getUpcoming } from "@/lib/calendar";
import type { TriggerContext } from "../types";
import { billDue } from "./bill-due";
import { ccDue } from "./cc-due";
import { recurringPriceChange } from "./recurring-price-change";
import { recurringMissing } from "./recurring-missing";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    financialAccount: { findMany: vi.fn() },
    recurringRule: { findMany: vi.fn() },
    transaction: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));
vi.mock("@/lib/calendar", () => ({ getUpcoming: vi.fn() }));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1",
  params: {},
  todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"),
  ...over,
});

beforeEach(() => vi.clearAllMocks());

describe("bill-due", () => {
  it("fires for upcoming expense bills within the window", async () => {
    vi.mocked(getUpcoming).mockResolvedValue([
      { date: "2026-07-11", description: "Netflix", amount: 15.49, type: "EXPENSE", categoryId: null, recurring: true },
      { date: "2026-07-10", description: "Paycheck", amount: 2000, type: "INCOME", categoryId: null, recurring: true },
    ] as never);
    const events = await billDue.evaluate(ctx({ params: { days: 3 } }));
    expect(events).toEqual([
      {
        dedupeKey: "bill-due:Netflix:2026-07-11",
        vars: { name: "Netflix", amount: "$15.49", due_date: "2026-07-11", days: "2" },
      },
    ]);
    expect(getUpcoming).toHaveBeenCalledWith("u1", "2026-07-09", 3);
  });
});

describe("cc-due", () => {
  const card = (over: Record<string, unknown> = {}) => ({
    id: "a1", name: "Sapphire", nextPaymentDueDate: new Date("2026-07-11T00:00:00Z"),
    lastStatementBalance: 250, isOverdue: null, ...over,
  });

  it("fires for a statement due inside the window", async () => {
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([card()] as never);
    const events = await ccDue.evaluate(ctx({ params: { days: 3 } }));
    expect(events).toEqual([
      {
        dedupeKey: "cc-due:a1:2026-07-11",
        vars: { account: "Sapphire", amount: "$250.00", due_date: "2026-07-11", days: "2" },
      },
    ]);
  });

  it("skips zero statements, non-overdue past dates, and dates beyond the window", async () => {
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      card({ id: "a2", lastStatementBalance: 0 }),
      card({ id: "a3", nextPaymentDueDate: new Date("2026-07-01T00:00:00Z"), isOverdue: false }),
      card({ id: "a4", nextPaymentDueDate: new Date("2026-07-20T00:00:00Z") }),
    ] as never);
    expect(await ccDue.evaluate(ctx({ params: { days: 3 } }))).toEqual([]);
  });

  it("fires for an overdue card even past the due date", async () => {
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      card({ nextPaymentDueDate: new Date("2026-07-01T00:00:00Z"), isOverdue: true }),
    ] as never);
    const events = await ccDue.evaluate(ctx({ params: { days: 3 } }));
    expect(events).toHaveLength(1);
    expect(events[0].vars.days).toBe("0");
  });
});

describe("recurring-price-change", () => {
  it("fires when a matched transaction differs from its rule by at least minPercent", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", amount: 18.99, recurringRule: { id: "r1", description: "Netflix", amount: 15.49 } },
    ] as never);
    const events = await recurringPriceChange.evaluate(
      ctx({ params: { minPercent: 10 }, event: { kind: "plaid-sync", newTransactionIds: ["t1"] } }),
    );
    expect(events).toEqual([
      {
        dedupeKey: "recurring-price-change:r1:t1",
        vars: { name: "Netflix", old_amount: "$15.49", new_amount: "$18.99", change: "+23%" },
      },
    ]);
  });

  it("is silent under the threshold and without an event", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", amount: 15.99, recurringRule: { id: "r1", description: "Netflix", amount: 15.49 } },
    ] as never);
    expect(
      await recurringPriceChange.evaluate(
        ctx({ params: { minPercent: 10 }, event: { kind: "plaid-sync", newTransactionIds: ["t1"] } }),
      ),
    ).toEqual([]);
    expect(await recurringPriceChange.evaluate(ctx({ params: { minPercent: 10 } }))).toEqual([]);
  });
});

describe("recurring-missing", () => {
  const rule = {
    id: "r1", description: "Netflix", frequency: "MONTHLY", interval: 1,
    startDate: new Date("2026-01-01T00:00:00Z"), endDate: null, dayOfMonth: 1, weekday: null,
  };

  it("fires when the last expected occurrence has no matching transaction past the grace period", async () => {
    vi.mocked(prisma.recurringRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue(null);
    const events = await recurringMissing.evaluate(ctx({ params: { graceDays: 3 } }));
    expect(events).toEqual([
      {
        dedupeKey: "recurring-missing:r1:2026-07-01",
        vars: { name: "Netflix", expected_date: "2026-07-01", days_late: "8" },
      },
    ]);
  });

  it("is silent when a transaction matched the occurrence", async () => {
    vi.mocked(prisma.recurringRule.findMany).mockResolvedValue([rule] as never);
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({ id: "t1" } as never);
    expect(await recurringMissing.evaluate(ctx({ params: { graceDays: 3 } }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/notifications/triggers/bills.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the four triggers**

`src/lib/notifications/triggers/bill-due.ts`:

```ts
import { z } from "zod";
import { getUpcoming } from "@/lib/calendar";
import { formatUSD } from "@/lib/money";
import { parseISODay } from "@/lib/dates";
import type { TriggerDef } from "../types";

const DAY_MS = 86_400_000;

export const billDue: TriggerDef = {
  id: "bill-due",
  label: "Bill coming up",
  description: "A recurring or scheduled expense is due within N days.",
  group: "bills",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({
    days: z.number().int().min(1).max(30).default(3),
  }),
  paramFields: [{ key: "days", label: "Days ahead", kind: "number", min: 1, max: 30 }],
  variables: [
    { name: "name", description: "Bill description" },
    { name: "amount", description: "Bill amount" },
    { name: "due_date", description: "Due date (YYYY-MM-DD)" },
    { name: "days", description: "Days until due" },
  ],
  defaultTemplate: {
    title: "{{name}} due in {{days}} days",
    body: "{{name}} ({{amount}}) is due {{due_date}}.",
  },
  sampleVars: { name: "Netflix", amount: "$15.49", due_date: "2026-07-12", days: "3" },
  async evaluate(ctx) {
    const { days } = ctx.params as { days: number };
    const today = parseISODay(ctx.todayISO);
    const upcoming = await getUpcoming(ctx.userId, ctx.todayISO, days);
    return upcoming
      .filter((u) => u.type === "EXPENSE")
      .map((u) => ({
        dedupeKey: `bill-due:${u.description}:${u.date}`,
        vars: {
          name: u.description,
          amount: formatUSD(u.amount),
          due_date: u.date,
          days: String(Math.round((parseISODay(u.date).getTime() - today.getTime()) / DAY_MS)),
        },
      }));
  },
};
```

`src/lib/notifications/triggers/cc-due.ts` (visibility rules match the old digest: skip zero statements, past-due only when Plaid says `isOverdue`):

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import { addUTCDays, isoDay, parseISODay } from "@/lib/dates";
import type { TriggerDef, TriggerEvent } from "../types";

const DAY_MS = 86_400_000;

export const ccDue: TriggerDef = {
  id: "cc-due",
  label: "Credit card payment due",
  description: "A credit card statement payment is due within N days, or the card is overdue.",
  group: "bills",
  modes: ["sweep"],
  severity: "warning",
  paramsSchema: z.object({
    days: z.number().int().min(1).max(30).default(3),
  }),
  paramFields: [{ key: "days", label: "Days ahead", kind: "number", min: 1, max: 30 }],
  variables: [
    { name: "account", description: "Card name" },
    { name: "amount", description: "Statement balance" },
    { name: "due_date", description: "Due date (YYYY-MM-DD)" },
    { name: "days", description: "Days until due (0 when overdue)" },
  ],
  defaultTemplate: {
    title: "{{account}} payment due {{due_date}}",
    body: "{{account}}: {{amount}} statement balance due {{due_date}}.",
  },
  sampleVars: { account: "Sapphire", amount: "$250.00", due_date: "2026-07-12", days: "3" },
  async evaluate(ctx) {
    const { days } = ctx.params as { days: number };
    const today = parseISODay(ctx.todayISO);
    const horizon = addUTCDays(today, days);
    const cards = await prisma.financialAccount.findMany({
      where: { userId: ctx.userId, archived: false, type: "CREDIT_CARD", nextPaymentDueDate: { not: null } },
      select: { id: true, name: true, nextPaymentDueDate: true, lastStatementBalance: true, isOverdue: true },
    });
    const events: TriggerEvent[] = [];
    for (const card of cards) {
      const due = card.nextPaymentDueDate!;
      const amount = toNumber(card.lastStatementBalance ?? 0);
      if (amount <= 0) continue;
      const past = due.getTime() < today.getTime();
      if (past && card.isOverdue !== true) continue;
      if (!past && due.getTime() > horizon.getTime()) continue;
      events.push({
        dedupeKey: `cc-due:${card.id}:${isoDay(due)}`,
        vars: {
          account: card.name,
          amount: formatUSD(amount),
          due_date: isoDay(due),
          days: String(Math.max(0, Math.round((due.getTime() - today.getTime()) / DAY_MS))),
        },
      });
    }
    return events;
  },
};
```

`src/lib/notifications/triggers/recurring-price-change.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef, TriggerEvent } from "../types";

export const recurringPriceChange: TriggerDef = {
  id: "recurring-price-change",
  label: "Recurring charge changed price",
  description: "A synced or imported transaction matched a recurring rule at a different amount.",
  group: "bills",
  modes: ["event"],
  severity: "warning",
  paramsSchema: z.object({
    minPercent: z.number().min(1).max(100).default(10),
  }),
  paramFields: [
    { key: "minPercent", label: "Minimum change (%)", kind: "number", min: 1, max: 100 },
  ],
  variables: [
    { name: "name", description: "Recurring rule description" },
    { name: "old_amount", description: "Expected amount" },
    { name: "new_amount", description: "Charged amount" },
    { name: "change", description: "Signed percent change" },
  ],
  defaultTemplate: {
    title: "{{name}} price changed {{change}}",
    body: "{{name}} charged {{new_amount}}, expected {{old_amount}}.",
  },
  sampleVars: { name: "Netflix", old_amount: "$15.49", new_amount: "$18.99", change: "+23%" },
  async evaluate(ctx) {
    const { minPercent } = ctx.params as { minPercent: number };
    if (!ctx.event || ctx.event.newTransactionIds.length === 0) return [];
    const txns = await prisma.transaction.findMany({
      where: {
        id: { in: ctx.event.newTransactionIds },
        userId: ctx.userId,
        deletedAt: null,
        recurringRuleId: { not: null },
      },
      select: {
        id: true,
        amount: true,
        recurringRule: { select: { id: true, description: true, amount: true } },
      },
    });
    const events: TriggerEvent[] = [];
    for (const t of txns) {
      if (!t.recurringRule) continue;
      const expected = toNumber(t.recurringRule.amount);
      const charged = toNumber(t.amount);
      if (expected <= 0) continue;
      const changePct = ((charged - expected) / expected) * 100;
      if (Math.abs(changePct) < minPercent) continue;
      events.push({
        dedupeKey: `recurring-price-change:${t.recurringRule.id}:${t.id}`,
        vars: {
          name: t.recurringRule.description,
          old_amount: formatUSD(expected),
          new_amount: formatUSD(charged),
          change: `${changePct >= 0 ? "+" : ""}${changePct.toFixed(0)}%`,
        },
      });
    }
    return events;
  },
};
```

`src/lib/notifications/triggers/recurring-missing.ts` (a transaction within 4 days before the expected date counts as fulfilled, mirroring the calendar's proximity suppression window):

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { expandOccurrences } from "@/lib/recurrence";
import { addUTCDays, isoDay, parseISODay } from "@/lib/dates";
import type { TriggerDef, TriggerEvent } from "../types";

const DAY_MS = 86_400_000;

export const recurringMissing: TriggerDef = {
  id: "recurring-missing",
  label: "Expected recurring charge missing",
  description: "A recurring rule's expected occurrence has no matching transaction past a grace period.",
  group: "bills",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({
    graceDays: z.number().int().min(1).max(14).default(3),
  }),
  paramFields: [{ key: "graceDays", label: "Grace days", kind: "number", min: 1, max: 14 }],
  variables: [
    { name: "name", description: "Recurring rule description" },
    { name: "expected_date", description: "Expected date (YYYY-MM-DD)" },
    { name: "days_late", description: "Days past the expected date" },
  ],
  defaultTemplate: {
    title: "{{name}} hasn't shown up",
    body: "{{name}} was expected {{expected_date}} ({{days_late}} days ago) and hasn't appeared.",
  },
  sampleVars: { name: "Netflix", expected_date: "2026-07-01", days_late: "8" },
  async evaluate(ctx) {
    const { graceDays } = ctx.params as { graceDays: number };
    const today = parseISODay(ctx.todayISO);
    const cutoff = addUTCDays(today, -graceDays);
    const windowStart = addUTCDays(today, -60);
    const rules = await prisma.recurringRule.findMany({
      where: { userId: ctx.userId, archived: false },
      select: {
        id: true, description: true, frequency: true, interval: true,
        startDate: true, endDate: true, dayOfMonth: true, weekday: true,
      },
    });
    const events: TriggerEvent[] = [];
    for (const rule of rules) {
      const expected = expandOccurrences(rule, windowStart, cutoff).at(-1);
      if (!expected) continue;
      const matched = await prisma.transaction.findFirst({
        where: {
          userId: ctx.userId,
          recurringRuleId: rule.id,
          deletedAt: null,
          date: { gte: addUTCDays(expected, -4) },
        },
        select: { id: true },
      });
      if (matched) continue;
      events.push({
        dedupeKey: `recurring-missing:${rule.id}:${isoDay(expected)}`,
        vars: {
          name: rule.description,
          expected_date: isoDay(expected),
          days_late: String(Math.round((today.getTime() - expected.getTime()) / DAY_MS)),
        },
      });
    }
    return events;
  },
};
```

- [ ] **Step 4: Register the triggers**

In `src/lib/notifications/triggers/index.ts` add:

```ts
import { billDue } from "./bill-due";
import { ccDue } from "./cc-due";
import { recurringPriceChange } from "./recurring-price-change";
import { recurringMissing } from "./recurring-missing";
```

and extend the array:

```ts
export const TRIGGERS: TriggerDef[] = [
  plaidReauth, syncFailing, accountStale,
  budgetExceeded, budgetThreshold, budgetPace,
  billDue, ccDue, recurringPriceChange, recurringMissing,
];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/notifications/triggers/bills.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/triggers
git commit -m "feat: bills and recurring notification triggers"
```

---

### Task 8: Transaction & balance triggers

**Files:**
- Create: `src/lib/notifications/triggers/large-transaction.ts`, `new-merchant.ts`, `low-balance.ts`, `cc-utilization.ts`, `income-received.ts`
- Modify: `src/lib/notifications/triggers/index.ts`
- Test: `src/lib/notifications/triggers/transactions.test.ts`

**Interfaces:**
- Consumes: `prisma.transaction` (`findMany`, `count`), `prisma.financialAccount` (`findMany`, `findFirst` with `currentBalance`, `creditLimit`, `isAsset`), event payload `newTransactionIds` from Task 3 types.
- Produces: registry entries `large-transaction`, `new-merchant`, `low-balance`, `cc-utilization`, `income-received`. Dedupe keys: `large-transaction:<txnId>`, `new-merchant:<lowercased description>`, `low-balance:<accountId>:<todayISO>`, `cc-utilization:<accountId>:<todayISO>`, `income-received:<txnId>`.

- [ ] **Step 1: Write the failing tests**

`src/lib/notifications/triggers/transactions.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import type { TriggerContext } from "../types";
import { largeTransaction } from "./large-transaction";
import { newMerchant } from "./new-merchant";
import { lowBalance } from "./low-balance";
import { ccUtilization } from "./cc-utilization";
import { incomeReceived } from "./income-received";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findMany: vi.fn(), count: vi.fn() },
    financialAccount: { findMany: vi.fn(), findFirst: vi.fn() },
  },
}));

const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
  userId: "u1",
  params: {},
  todayISO: "2026-07-09",
  now: new Date("2026-07-09T12:00:00Z"),
  ...over,
});

const syncEvent = (ids: string[]) => ({ kind: "plaid-sync" as const, newTransactionIds: ids });

beforeEach(() => vi.clearAllMocks());

describe("large-transaction", () => {
  it("fires per new expense over the threshold", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", description: "Best Buy", amount: 899.99, account: { name: "Checking" }, category: { name: "Shopping" } },
    ] as never);
    const events = await largeTransaction.evaluate(ctx({ params: { amount: 500 }, event: syncEvent(["t1"]) }));
    expect(events).toEqual([
      {
        dedupeKey: "large-transaction:t1",
        vars: { merchant: "Best Buy", amount: "$899.99", account: "Checking", category: "Shopping" },
      },
    ]);
  });

  it("is silent without an event", async () => {
    expect(await largeTransaction.evaluate(ctx({ params: { amount: 500 } }))).toEqual([]);
  });
});

describe("new-merchant", () => {
  it("fires for a merchant with no prior transactions", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", description: "Blue Bottle", amount: 6.5, account: { name: "Checking" } },
    ] as never);
    vi.mocked(prisma.transaction.count).mockResolvedValue(0);
    const events = await newMerchant.evaluate(ctx({ event: syncEvent(["t1"]) }));
    expect(events).toEqual([
      {
        dedupeKey: "new-merchant:blue bottle",
        vars: { merchant: "Blue Bottle", amount: "$6.50", account: "Checking" },
      },
    ]);
  });

  it("is silent for a merchant seen before", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", description: "Blue Bottle", amount: 6.5, account: { name: "Checking" } },
    ] as never);
    vi.mocked(prisma.transaction.count).mockResolvedValue(2);
    expect(await newMerchant.evaluate(ctx({ event: syncEvent(["t1"]) }))).toEqual([]);
  });
});

describe("low-balance", () => {
  it("fires when the account balance is under the threshold", async () => {
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(
      { id: "a1", name: "Checking", currentBalance: 87.2 } as never,
    );
    const events = await lowBalance.evaluate(ctx({ params: { amount: 100, accountId: "a1" } }));
    expect(events).toEqual([
      {
        dedupeKey: "low-balance:a1:2026-07-09",
        vars: { account: "Checking", balance: "$87.20", threshold: "$100.00" },
      },
    ]);
  });

  it("is silent at or above the threshold, or if the account is gone", async () => {
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(
      { id: "a1", name: "Checking", currentBalance: 100 } as never,
    );
    expect(await lowBalance.evaluate(ctx({ params: { amount: 100, accountId: "a1" } }))).toEqual([]);
    vi.mocked(prisma.financialAccount.findFirst).mockResolvedValue(null);
    expect(await lowBalance.evaluate(ctx({ params: { amount: 100, accountId: "a1" } }))).toEqual([]);
  });
});

describe("cc-utilization", () => {
  it("fires when utilization crosses the percent", async () => {
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      { id: "a1", name: "Sapphire", currentBalance: 3200, creditLimit: 10000 },
    ] as never);
    const events = await ccUtilization.evaluate(ctx({ params: { percent: 30 } }));
    expect(events).toEqual([
      {
        dedupeKey: "cc-utilization:a1:2026-07-09",
        vars: { account: "Sapphire", percent: "32", balance: "$3,200.00", limit: "$10,000.00" },
      },
    ]);
  });

  it("is silent under the percent", async () => {
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      { id: "a1", name: "Sapphire", currentBalance: 2000, creditLimit: 10000 },
    ] as never);
    expect(await ccUtilization.evaluate(ctx({ params: { percent: 30 } }))).toEqual([]);
  });
});

describe("income-received", () => {
  it("fires per new income transaction at or above the minimum", async () => {
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([
      { id: "t1", description: "Acme Payroll", amount: 2400, account: { name: "Checking" } },
    ] as never);
    const events = await incomeReceived.evaluate(ctx({ params: { minAmount: 100 }, event: syncEvent(["t1"]) }));
    expect(events).toEqual([
      {
        dedupeKey: "income-received:t1",
        vars: { merchant: "Acme Payroll", amount: "$2,400.00", account: "Checking" },
      },
    ]);
  });

  it("is silent without an event", async () => {
    expect(await incomeReceived.evaluate(ctx({ params: { minAmount: 100 } }))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/notifications/triggers/transactions.test.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement the five triggers**

`src/lib/notifications/triggers/large-transaction.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef } from "../types";

export const largeTransaction: TriggerDef = {
  id: "large-transaction",
  label: "Large transaction",
  description: "A new expense at or above a dollar threshold.",
  group: "transactions",
  modes: ["event"],
  severity: "warning",
  paramsSchema: z.object({
    amount: z.number().min(1).default(500),
    accountId: z.string().optional(),
  }),
  paramFields: [
    { key: "amount", label: "Amount ($)", kind: "number", min: 1 },
    { key: "accountId", label: "Account (all if empty)", kind: "select", optionsFrom: "account", optional: true },
  ],
  variables: [
    { name: "merchant", description: "Transaction description" },
    { name: "amount", description: "Transaction amount" },
    { name: "account", description: "Account name" },
    { name: "category", description: "Category name" },
  ],
  defaultTemplate: {
    title: "Large transaction: {{merchant}}",
    body: "{{merchant}} charged {{amount}} on {{account}} ({{category}}).",
  },
  sampleVars: { merchant: "Best Buy", amount: "$899.99", account: "Checking", category: "Shopping" },
  async evaluate(ctx) {
    const { amount, accountId } = ctx.params as { amount: number; accountId?: string };
    if (!ctx.event || ctx.event.newTransactionIds.length === 0) return [];
    const txns = await prisma.transaction.findMany({
      where: {
        id: { in: ctx.event.newTransactionIds },
        userId: ctx.userId,
        deletedAt: null,
        isTransfer: false,
        type: "EXPENSE",
        amount: { gte: amount },
        ...(accountId ? { accountId } : {}),
      },
      select: {
        id: true, description: true, amount: true,
        account: { select: { name: true } },
        category: { select: { name: true } },
      },
    });
    return txns.map((t) => ({
      dedupeKey: `large-transaction:${t.id}`,
      vars: {
        merchant: t.description,
        amount: formatUSD(toNumber(t.amount)),
        account: t.account?.name ?? "Unlinked",
        category: t.category?.name ?? "Uncategorized",
      },
    }));
  },
};
```

`src/lib/notifications/triggers/new-merchant.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef, TriggerEvent } from "../types";

export const newMerchant: TriggerDef = {
  id: "new-merchant",
  label: "First charge from a new merchant",
  description: "A new expense from a merchant with no prior transactions.",
  group: "transactions",
  modes: ["event"],
  severity: "info",
  paramsSchema: z.object({
    accountId: z.string().optional(),
  }),
  paramFields: [
    { key: "accountId", label: "Account (all if empty)", kind: "select", optionsFrom: "account", optional: true },
  ],
  variables: [
    { name: "merchant", description: "Merchant name" },
    { name: "amount", description: "Transaction amount" },
    { name: "account", description: "Account name" },
  ],
  defaultTemplate: {
    title: "New merchant: {{merchant}}",
    body: "First charge from {{merchant}}: {{amount}} on {{account}}.",
  },
  sampleVars: { merchant: "Blue Bottle", amount: "$6.50", account: "Checking" },
  async evaluate(ctx) {
    const { accountId } = ctx.params as { accountId?: string };
    if (!ctx.event || ctx.event.newTransactionIds.length === 0) return [];
    const txns = await prisma.transaction.findMany({
      where: {
        id: { in: ctx.event.newTransactionIds },
        userId: ctx.userId,
        deletedAt: null,
        isTransfer: false,
        type: "EXPENSE",
        ...(accountId ? { accountId } : {}),
      },
      select: { id: true, description: true, amount: true, account: { select: { name: true } } },
    });
    const events: TriggerEvent[] = [];
    for (const t of txns) {
      const prior = await prisma.transaction.count({
        where: {
          userId: ctx.userId,
          deletedAt: null,
          description: t.description,
          id: { notIn: ctx.event.newTransactionIds },
        },
      });
      if (prior > 0) continue;
      events.push({
        dedupeKey: `new-merchant:${t.description.toLowerCase()}`,
        vars: {
          merchant: t.description,
          amount: formatUSD(toNumber(t.amount)),
          account: t.account?.name ?? "Unlinked",
        },
      });
    }
    return events;
  },
};
```

`src/lib/notifications/triggers/low-balance.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef } from "../types";

export const lowBalance: TriggerDef = {
  id: "low-balance",
  label: "Low account balance",
  description: "An account's balance dropped below a dollar threshold.",
  group: "transactions",
  modes: ["sweep", "event"],
  severity: "critical",
  paramsSchema: z.object({
    amount: z.number().min(0).default(100),
    accountId: z.string().min(1, "Pick an account."),
  }),
  paramFields: [
    { key: "amount", label: "Threshold ($)", kind: "number", min: 0 },
    { key: "accountId", label: "Account", kind: "select", optionsFrom: "account" },
  ],
  variables: [
    { name: "account", description: "Account name" },
    { name: "balance", description: "Current balance" },
    { name: "threshold", description: "Configured threshold" },
  ],
  defaultTemplate: {
    title: "{{account}} balance is low",
    body: "{{account}} is at {{balance}}, below your {{threshold}} threshold.",
  },
  sampleVars: { account: "Checking", balance: "$87.20", threshold: "$100.00" },
  async evaluate(ctx) {
    const { amount, accountId } = ctx.params as { amount: number; accountId: string };
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, userId: ctx.userId, archived: false },
      select: { id: true, name: true, currentBalance: true },
    });
    if (!account) return [];
    const balance = toNumber(account.currentBalance);
    if (balance >= amount) return [];
    return [
      {
        dedupeKey: `low-balance:${account.id}:${ctx.todayISO}`,
        vars: { account: account.name, balance: formatUSD(balance), threshold: formatUSD(amount) },
      },
    ];
  },
};
```

`src/lib/notifications/triggers/cc-utilization.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef, TriggerEvent } from "../types";

export const ccUtilization: TriggerDef = {
  id: "cc-utilization",
  label: "High credit utilization",
  description: "A credit card's balance crossed a percent of its limit.",
  group: "transactions",
  modes: ["sweep", "event"],
  severity: "warning",
  paramsSchema: z.object({
    percent: z.number().int().min(1).max(100).default(30),
    accountId: z.string().optional(),
  }),
  paramFields: [
    { key: "percent", label: "Utilization (%)", kind: "number", min: 1, max: 100 },
    { key: "accountId", label: "Card (all if empty)", kind: "select", optionsFrom: "account", optional: true },
  ],
  variables: [
    { name: "account", description: "Card name" },
    { name: "percent", description: "Current utilization percent" },
    { name: "balance", description: "Current balance" },
    { name: "limit", description: "Credit limit" },
  ],
  defaultTemplate: {
    title: "{{account}} utilization at {{percent}}%",
    body: "{{account}}: {{balance}} of a {{limit}} limit.",
  },
  sampleVars: { account: "Sapphire", percent: "32", balance: "$3,200.00", limit: "$10,000.00" },
  async evaluate(ctx) {
    const { percent, accountId } = ctx.params as { percent: number; accountId?: string };
    const cards = await prisma.financialAccount.findMany({
      where: {
        userId: ctx.userId,
        archived: false,
        type: "CREDIT_CARD",
        creditLimit: { not: null },
        ...(accountId ? { id: accountId } : {}),
      },
      select: { id: true, name: true, currentBalance: true, creditLimit: true },
    });
    const events: TriggerEvent[] = [];
    for (const card of cards) {
      const limit = toNumber(card.creditLimit!);
      if (limit <= 0) continue;
      const balance = toNumber(card.currentBalance);
      const util = (balance / limit) * 100;
      if (util < percent) continue;
      events.push({
        dedupeKey: `cc-utilization:${card.id}:${ctx.todayISO}`,
        vars: {
          account: card.name,
          percent: String(Math.round(util)),
          balance: formatUSD(balance),
          limit: formatUSD(limit),
        },
      });
    }
    return events;
  },
};
```

`src/lib/notifications/triggers/income-received.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { formatUSD, toNumber } from "@/lib/money";
import type { TriggerDef } from "../types";

export const incomeReceived: TriggerDef = {
  id: "income-received",
  label: "Income received",
  description: "A new income transaction landed.",
  group: "transactions",
  modes: ["event"],
  severity: "info",
  paramsSchema: z.object({
    minAmount: z.number().min(0).default(0),
    accountId: z.string().optional(),
  }),
  paramFields: [
    { key: "minAmount", label: "Minimum amount ($)", kind: "number", min: 0 },
    { key: "accountId", label: "Account (all if empty)", kind: "select", optionsFrom: "account", optional: true },
  ],
  variables: [
    { name: "merchant", description: "Transaction description" },
    { name: "amount", description: "Amount received" },
    { name: "account", description: "Account name" },
  ],
  defaultTemplate: {
    title: "Income received: {{amount}}",
    body: "{{merchant}} deposited {{amount}} to {{account}}.",
  },
  sampleVars: { merchant: "Acme Payroll", amount: "$2,400.00", account: "Checking" },
  async evaluate(ctx) {
    const { minAmount, accountId } = ctx.params as { minAmount: number; accountId?: string };
    if (!ctx.event || ctx.event.newTransactionIds.length === 0) return [];
    const txns = await prisma.transaction.findMany({
      where: {
        id: { in: ctx.event.newTransactionIds },
        userId: ctx.userId,
        deletedAt: null,
        isTransfer: false,
        type: "INCOME",
        amount: { gte: minAmount },
        ...(accountId ? { accountId } : {}),
      },
      select: { id: true, description: true, amount: true, account: { select: { name: true } } },
    });
    return txns.map((t) => ({
      dedupeKey: `income-received:${t.id}`,
      vars: {
        merchant: t.description,
        amount: formatUSD(toNumber(t.amount)),
        account: t.account?.name ?? "Unlinked",
      },
    }));
  },
};
```

- [ ] **Step 4: Register the triggers**

In `src/lib/notifications/triggers/index.ts` add:

```ts
import { largeTransaction } from "./large-transaction";
import { newMerchant } from "./new-merchant";
import { lowBalance } from "./low-balance";
import { ccUtilization } from "./cc-utilization";
import { incomeReceived } from "./income-received";
```

and extend the array:

```ts
export const TRIGGERS: TriggerDef[] = [
  plaidReauth, syncFailing, accountStale,
  budgetExceeded, budgetThreshold, budgetPace,
  billDue, ccDue, recurringPriceChange, recurringMissing,
  largeTransaction, newMerchant, lowBalance, ccUtilization, incomeReceived,
];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/notifications/triggers/transactions.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/triggers
git commit -m "feat: transaction and balance notification triggers"
```

---

### Task 9: Digest trigger

Reimplements the old `src/lib/alerts/digest.ts` logic (deleted in Task 1) as a trigger. Self-gates: `latestSlot` finds the most recent scheduled send time; embedding its date in the dedupe key means the first sweep past the slot fires once and later sweeps hit the dedupe. Slot math uses server-local time, matching the old cron behavior.

**Files:**
- Create: `src/lib/notifications/triggers/digest.ts`
- Modify: `src/lib/notifications/triggers/index.ts`
- Test: `src/lib/notifications/triggers/digest.test.ts`

**Interfaces:**
- Consumes: `getUpcoming` (`@/lib/calendar`), `getBudgetMonth` (`@/lib/queries/budgets`), `prisma.financialAccount`, `formatUSD`/`toNumber`, `parseISODay`/`isoDay`/`addUTCDays`.
- Produces: registry entry `digest`; exported `latestSlot(now: Date, frequency: "daily" | "weekly", hour: number, weekday: number): Date` (exported for tests). Dedupe key: `digest:<frequency>:<slot YYYY-MM-DD>`.

- [ ] **Step 1: Write the failing tests**

`src/lib/notifications/triggers/digest.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { getUpcoming } from "@/lib/calendar";
import { getBudgetMonth } from "@/lib/queries/budgets";
import type { TriggerContext } from "../types";
import { digest, latestSlot } from "./digest";

vi.mock("@/lib/prisma", () => ({
  prisma: { financialAccount: { findMany: vi.fn() } },
}));
vi.mock("@/lib/calendar", () => ({ getUpcoming: vi.fn() }));
vi.mock("@/lib/queries/budgets", () => ({ getBudgetMonth: vi.fn() }));

describe("latestSlot", () => {
  it("daily: same day when the hour has passed", () => {
    const slot = latestSlot(new Date(2026, 6, 9, 12, 30), "daily", 8, 1);
    expect([slot.getFullYear(), slot.getMonth(), slot.getDate(), slot.getHours()]).toEqual([2026, 6, 9, 8]);
  });

  it("daily: previous day when the hour hasn't arrived", () => {
    const slot = latestSlot(new Date(2026, 6, 9, 6, 0), "daily", 8, 1);
    expect(slot.getDate()).toBe(8);
    expect(slot.getHours()).toBe(8);
  });

  it("weekly: most recent requested weekday at the hour", () => {
    // 2026-07-09 is a Thursday; most recent Monday 08:00 is 2026-07-06.
    const slot = latestSlot(new Date(2026, 6, 9, 12, 0), "weekly", 8, 1);
    expect([slot.getMonth(), slot.getDate(), slot.getHours()]).toEqual([6, 6, 8]);
  });

  it("weekly: steps back a week when today is the weekday but before the hour", () => {
    // 2026-07-06 is a Monday.
    const slot = latestSlot(new Date(2026, 6, 6, 6, 0), "weekly", 8, 1);
    expect(slot.getDate()).toBe(29); // Monday 2026-06-29
  });
});

describe("digest trigger", () => {
  const ctx = (over: Partial<TriggerContext> = {}): TriggerContext => ({
    userId: "u1",
    params: { frequency: "daily", weekday: 1, hour: 8, days: 3 },
    todayISO: "2026-07-09",
    now: new Date(2026, 6, 9, 12, 0),
    ...over,
  });

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([] as never);
    vi.mocked(getUpcoming).mockResolvedValue([] as never);
    vi.mocked(getBudgetMonth).mockResolvedValue([] as never);
  });

  it("emits nothing when there is nothing to report", async () => {
    expect(await digest.evaluate(ctx())).toEqual([]);
  });

  it("emits one event keyed to the slot date with a summary variable", async () => {
    vi.mocked(getUpcoming).mockResolvedValue([
      { date: "2026-07-10", description: "Netflix", amount: 15.49, type: "EXPENSE", categoryId: null, recurring: true },
    ] as never);
    const events = await digest.evaluate(ctx());
    expect(events).toHaveLength(1);
    expect(events[0].dedupeKey).toBe("digest:daily:2026-07-09");
    expect(events[0].vars.summary).toContain("Netflix");
    expect(events[0].vars.summary).toContain("$15.49");
  });

  it("includes overdue cards and over-budget categories in the summary", async () => {
    vi.mocked(prisma.financialAccount.findMany).mockResolvedValue([
      { name: "Sapphire", nextPaymentDueDate: new Date("2026-07-01T00:00:00Z"), lastStatementBalance: 250, isOverdue: true },
    ] as never);
    vi.mocked(getBudgetMonth).mockResolvedValue([
      { categoryId: "c1", name: "Groceries", color: "#888", icon: "cart", limit: 500, actual: 512.5, rollover: false, carryover: 0, effectiveLimit: 500 },
    ] as never);
    const events = await digest.evaluate(ctx());
    expect(events[0].vars.summary).toContain("Sapphire");
    expect(events[0].vars.summary).toContain("OVERDUE");
    expect(events[0].vars.summary).toContain("Groceries");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/notifications/triggers/digest.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

`src/lib/notifications/triggers/digest.ts`:

```ts
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getUpcoming } from "@/lib/calendar";
import { getBudgetMonth } from "@/lib/queries/budgets";
import { formatUSD, toNumber } from "@/lib/money";
import { addUTCDays, isoDay, parseISODay } from "@/lib/dates";
import type { TriggerDef } from "../types";

/** Most recent scheduled send time at or before `now`, in server-local time
 *  (scheduled sends have no request cookie to read a user timezone from). */
export function latestSlot(
  now: Date,
  frequency: "daily" | "weekly",
  hour: number,
  weekday: number,
): Date {
  const slot = new Date(now);
  slot.setHours(hour, 0, 0, 0);
  if (frequency === "daily") {
    if (slot.getTime() > now.getTime()) slot.setDate(slot.getDate() - 1);
    return slot;
  }
  while (slot.getDay() !== weekday) slot.setDate(slot.getDate() - 1);
  if (slot.getTime() > now.getTime()) slot.setDate(slot.getDate() - 7);
  return slot;
}

async function buildSummary(userId: string, todayISO: string, days: number): Promise<string | null> {
  const today = parseISODay(todayISO);
  const horizon = addUTCDays(today, days);

  const [upcomingAll, cards, budgetLines] = await Promise.all([
    getUpcoming(userId, todayISO, days),
    prisma.financialAccount.findMany({
      where: { userId, archived: false, type: "CREDIT_CARD", nextPaymentDueDate: { not: null } },
      select: { name: true, nextPaymentDueDate: true, lastStatementBalance: true, isOverdue: true },
    }),
    getBudgetMonth(userId, todayISO),
  ]);

  const bills = upcomingAll.filter((u) => u.type === "EXPENSE");

  const cardLines: string[] = [];
  for (const card of cards) {
    const due = card.nextPaymentDueDate!;
    const amount = toNumber(card.lastStatementBalance ?? 0);
    if (amount <= 0) continue;
    const past = due.getTime() < today.getTime();
    if (past && card.isOverdue !== true) continue;
    if (!past && due.getTime() > horizon.getTime()) continue;
    cardLines.push(
      past
        ? `${card.name}: ${formatUSD(amount)} OVERDUE (was due ${isoDay(due)})`
        : `${card.name}: ${formatUSD(amount)} due ${isoDay(due)}`,
    );
  }

  const overBudget = budgetLines.filter((l) => l.effectiveLimit > 0 && l.actual > l.effectiveLimit);

  const sections: string[] = [];
  if (cardLines.length) sections.push(`Cards:\n${cardLines.join("\n")}`);
  if (bills.length) {
    sections.push(
      `Upcoming bills (next ${days} days):\n${bills
        .map((b) => `${b.date} ${b.description} ${formatUSD(b.amount)}`)
        .join("\n")}`,
    );
  }
  if (overBudget.length) {
    sections.push(
      `Over budget:\n${overBudget
        .map((l) => `${l.name}: ${formatUSD(l.actual)} of ${formatUSD(l.effectiveLimit)}`)
        .join("\n")}`,
    );
  }
  return sections.length ? sections.join("\n\n") : null;
}

export const digest: TriggerDef = {
  id: "digest",
  label: "Scheduled digest",
  description: "A daily or weekly summary of upcoming bills, card due dates, and over-budget categories.",
  group: "digest",
  modes: ["sweep"],
  severity: "info",
  paramsSchema: z.object({
    frequency: z.enum(["daily", "weekly"]).default("daily"),
    weekday: z.number().int().min(0).max(6).default(1),
    hour: z.number().int().min(0).max(23).default(8),
    days: z.number().int().min(1).max(30).default(3),
  }),
  paramFields: [
    {
      key: "frequency", label: "Frequency", kind: "select",
      options: [
        { value: "daily", label: "Daily" },
        { value: "weekly", label: "Weekly" },
      ],
    },
    {
      key: "weekday", label: "Weekday (weekly only)", kind: "select",
      options: [
        { value: "0", label: "Sunday" }, { value: "1", label: "Monday" },
        { value: "2", label: "Tuesday" }, { value: "3", label: "Wednesday" },
        { value: "4", label: "Thursday" }, { value: "5", label: "Friday" },
        { value: "6", label: "Saturday" },
      ],
      optional: true,
    },
    { key: "hour", label: "Hour (0-23, server time)", kind: "number", min: 0, max: 23 },
    { key: "days", label: "Bill look-ahead days", kind: "number", min: 1, max: 30 },
  ],
  variables: [{ name: "summary", description: "The rendered digest body" }],
  defaultTemplate: {
    title: "Moolah digest",
    body: "{{summary}}",
  },
  sampleVars: {
    summary: "Upcoming bills (next 3 days):\n2026-07-12 Netflix $15.49",
  },
  async evaluate(ctx) {
    const { frequency, weekday, hour, days } = ctx.params as {
      frequency: "daily" | "weekly"; weekday: number; hour: number; days: number;
    };
    const slot = latestSlot(ctx.now, frequency, hour, weekday);
    const slotKey = `${slot.getFullYear()}-${String(slot.getMonth() + 1).padStart(2, "0")}-${String(slot.getDate()).padStart(2, "0")}`;
    const summary = await buildSummary(ctx.userId, ctx.todayISO, days);
    if (summary === null) return [];
    return [{ dedupeKey: `digest:${frequency}:${slotKey}`, vars: { summary } }];
  },
};
```

- [ ] **Step 4: Register the trigger**

In `src/lib/notifications/triggers/index.ts` add `import { digest } from "./digest";` and append `digest` to the array:

```ts
export const TRIGGERS: TriggerDef[] = [
  plaidReauth, syncFailing, accountStale,
  budgetExceeded, budgetThreshold, budgetPace,
  billDue, ccDue, recurringPriceChange, recurringMissing,
  largeTransaction, newMerchant, lowBalance, ccUtilization, incomeReceived,
  digest,
];
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/lib/notifications/triggers/digest.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 6: Commit**

```bash
git add src/lib/notifications/triggers
git commit -m "feat: scheduled digest notification trigger"
```

---

### Task 10: Engine

**Files:**
- Create: `src/lib/notifications/engine.ts`
- Test: `src/lib/notifications/engine.test.ts`

**Interfaces:**
- Consumes: `TRIGGER_BY_ID` (Task 3+), `renderTemplate` (Task 2), `sendDiscord` (Task 4), `todayInZone` from `@/lib/user-tz`, `prisma.notificationRule`/`prisma.notification`.
- Produces: `runRules(userId: string, opts: RunOptions): Promise<RunSummary>` where `RunOptions = { mode: "sweep" | "event"; event?: NotificationEventPayload; ruleId?: string; test?: boolean }` and `RunSummary = { created: number; delivered: number; failed: number }`. Semantics: per-rule error isolation; dedupe skip on P2002; delivery failure never blocks the inbox row; test mode bypasses dedupe (`test:` key prefix) and synthesizes a sample event when nothing fires.

- [ ] **Step 1: Write the failing test**

`src/lib/notifications/engine.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { sendDiscord } from "./discord";
import { runRules } from "./engine";

const evaluate = vi.fn();

vi.mock("@/lib/prisma", () => ({
  prisma: {
    notificationRule: { findMany: vi.fn() },
    notification: { create: vi.fn(), update: vi.fn() },
  },
}));
vi.mock("./discord", () => ({ sendDiscord: vi.fn() }));
vi.mock("./triggers", () => ({
  TRIGGER_BY_ID: {
    get: (id: string) =>
      id === "fake-trigger"
        ? {
            id: "fake-trigger",
            modes: ["sweep"],
            severity: "info",
            paramsSchema: { parse: (v: unknown) => v ?? {} },
            defaultTemplate: { title: "Hi {{name}}", body: "Body {{name}}" },
            sampleVars: { name: "Sample" },
            evaluate,
          }
        : undefined,
  },
}));

const rule = (over: Record<string, unknown> = {}) => ({
  id: "r1", userId: "u1", name: "My rule", enabled: true, trigger: "fake-trigger",
  params: "{}", channelId: null, channel: null, templateTitle: null, templateBody: null,
  ...over,
});

const channel = { id: "ch1", userId: "u1", name: "alerts", kind: "discord", webhookUrl: "https://discord.com/api/webhooks/1/t" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(prisma.notification.create).mockResolvedValue({ id: "n1" } as never);
});

describe("runRules", () => {
  it("renders the default template, inserts an inbox row, and delivers to the channel", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([rule({ channelId: "ch1", channel })] as never);
    evaluate.mockResolvedValue([{ dedupeKey: "k1", vars: { name: "World" } }]);
    const summary = await runRules("u1", { mode: "sweep" });
    expect(prisma.notification.create).toHaveBeenCalledWith({
      data: {
        userId: "u1", ruleId: "r1", ruleName: "My rule",
        title: "Hi World", body: "Body World", dedupeKey: "k1",
      },
    });
    expect(sendDiscord).toHaveBeenCalledWith(channel.webhookUrl, { title: "Hi World", body: "Body World", severity: "info" });
    expect(prisma.notification.update).toHaveBeenCalledWith({ where: { id: "n1" }, data: { deliveryStatus: "sent" } });
    expect(summary).toEqual({ created: 1, delivered: 1, failed: 0 });
  });

  it("prefers the rule's custom template", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([
      rule({ templateTitle: "Custom {{name}}", templateBody: "B" }),
    ] as never);
    evaluate.mockResolvedValue([{ dedupeKey: "k1", vars: { name: "X" } }]);
    await runRules("u1", { mode: "sweep" });
    expect(prisma.notification.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ title: "Custom X", body: "B" }) }),
    );
  });

  it("skips silently on a dedupe conflict (P2002)", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([rule()] as never);
    evaluate.mockResolvedValue([{ dedupeKey: "k1", vars: {} }]);
    vi.mocked(prisma.notification.create).mockRejectedValue(Object.assign(new Error("dup"), { code: "P2002" }));
    const summary = await runRules("u1", { mode: "sweep" });
    expect(summary).toEqual({ created: 0, delivered: 0, failed: 0 });
  });

  it("records delivery failure on the row without throwing", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([rule({ channelId: "ch1", channel })] as never);
    evaluate.mockResolvedValue([{ dedupeKey: "k1", vars: { name: "W" } }]);
    vi.mocked(sendDiscord).mockRejectedValue(new Error("404 Not Found"));
    const summary = await runRules("u1", { mode: "sweep" });
    expect(prisma.notification.update).toHaveBeenCalledWith({
      where: { id: "n1" },
      data: { deliveryStatus: "failed", deliveryError: "404 Not Found" },
    });
    expect(summary).toEqual({ created: 1, delivered: 0, failed: 1 });
  });

  it("isolates one rule's evaluation error from the others", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([rule(), rule({ id: "r2", name: "Second" })] as never);
    evaluate
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce([{ dedupeKey: "k2", vars: { name: "ok" } }]);
    const summary = await runRules("u1", { mode: "sweep" });
    expect(summary.created).toBe(1);
  });

  it("skips rules whose trigger doesn't match the mode", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([rule()] as never);
    const summary = await runRules("u1", { mode: "event", event: { kind: "plaid-sync", newTransactionIds: [] } });
    expect(evaluate).not.toHaveBeenCalled();
    expect(summary).toEqual({ created: 0, delivered: 0, failed: 0 });
  });

  it("test mode synthesizes a sample event and prefixes the dedupe key", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([rule({ enabled: false })] as never);
    evaluate.mockResolvedValue([]);
    const summary = await runRules("u1", { mode: "sweep", ruleId: "r1", test: true });
    expect(prisma.notificationRule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "r1", userId: "u1" } }),
    );
    const data = vi.mocked(prisma.notification.create).mock.calls[0][0].data as { dedupeKey: string; title: string };
    expect(data.dedupeKey.startsWith("test:")).toBe(true);
    expect(data.title).toBe("Hi Sample");
    expect(summary.created).toBe(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/notifications/engine.test.ts`
Expected: FAIL — cannot find module `./engine`.

- [ ] **Step 3: Implement**

`src/lib/notifications/engine.ts`:

```ts
import { prisma } from "@/lib/prisma";
import { todayInZone } from "@/lib/user-tz";
import { TRIGGER_BY_ID } from "./triggers";
import { renderTemplate } from "./render";
import { sendDiscord } from "./discord";
import type { NotificationEventPayload, TriggerEvent } from "./types";

export interface RunOptions {
  mode: "sweep" | "event";
  event?: NotificationEventPayload;
  /** Run only this rule regardless of enabled/mode (the "Send test" path). */
  ruleId?: string;
  /** Bypass dedupe; synthesize a sample event when nothing fires. */
  test?: boolean;
}

export interface RunSummary {
  created: number;
  delivered: number;
  failed: number;
}

export async function runRules(userId: string, opts: RunOptions): Promise<RunSummary> {
  const rules = await prisma.notificationRule.findMany({
    where: opts.ruleId ? { id: opts.ruleId, userId } : { userId, enabled: true },
    include: { channel: true },
  });

  // Scheduled runs have no request to read a user timezone from.
  const todayISO = todayInZone(process.env.TZ);
  const now = new Date();
  const summary: RunSummary = { created: 0, delivered: 0, failed: 0 };

  for (const rule of rules) {
    const def = TRIGGER_BY_ID.get(rule.trigger);
    if (!def) continue;
    if (!opts.ruleId && !def.modes.includes(opts.mode)) continue;

    let events: TriggerEvent[] = [];
    try {
      const params = def.paramsSchema.parse(JSON.parse(rule.params)) as Record<string, unknown>;
      events = await def.evaluate({ userId, params, todayISO, now, event: opts.event });
    } catch (e) {
      console.error(`[notifications] rule ${rule.id} (${rule.trigger}) evaluation failed:`, e);
      continue;
    }

    if (opts.test && events.length === 0) {
      events = [{ dedupeKey: "sample", vars: def.sampleVars }];
    }

    for (const event of events) {
      const dedupeKey = opts.test ? `test:${Date.now()}:${event.dedupeKey}` : event.dedupeKey;
      const title = renderTemplate(rule.templateTitle ?? def.defaultTemplate.title, event.vars);
      const body = renderTemplate(rule.templateBody ?? def.defaultTemplate.body, event.vars);

      let notificationId: string;
      try {
        const created = await prisma.notification.create({
          data: { userId, ruleId: rule.id, ruleName: rule.name, title, body, dedupeKey },
        });
        notificationId = created.id;
        summary.created++;
      } catch (e) {
        if (isUniqueViolation(e)) continue; // already fired for this dedupe window
        console.error(`[notifications] insert failed for rule ${rule.id}:`, e);
        continue;
      }

      if (!rule.channel) continue;
      try {
        await sendDiscord(rule.channel.webhookUrl, { title, body, severity: def.severity });
        await prisma.notification.update({
          where: { id: notificationId },
          data: { deliveryStatus: "sent" },
        });
        summary.delivered++;
      } catch (e) {
        summary.failed++;
        await prisma.notification.update({
          where: { id: notificationId },
          data: {
            deliveryStatus: "failed",
            deliveryError: e instanceof Error ? e.message : "Delivery failed",
          },
        });
      }
    }
  }

  return summary;
}

function isUniqueViolation(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2002";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/notifications/engine.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/notifications/engine.ts src/lib/notifications/engine.test.ts
git commit -m "feat: notification rule engine"
```

---

### Task 11: Scheduler + event hooks

**Files:**
- Modify: `src/lib/notifications/scheduler.ts` (replace Task 1 stub)
- Test: `src/lib/notifications/scheduler.test.ts`
- Modify: `src/lib/plaid-sync.ts`, `src/app/api/plaid/sync/[itemId]/route.ts`, `src/actions/import.ts`

**Interfaces:**
- Consumes: `runRules` (Task 10), `node-cron`, `prisma.notificationRule`/`prisma.plaidItem`/`prisma.transaction`.
- Produces: `startNotificationScheduler(): Promise<void>`, `sweep(): Promise<void>`, `_resetSchedulerForTests(): void`. Instrumentation already calls `startNotificationScheduler` (Task 1). Event payloads: `{ kind: "plaid-sync", plaidItemId, newTransactionIds }` on success, `{ kind: "plaid-sync-failed", plaidItemId, reauthRequired, failureCount, newTransactionIds: [] }` on failure, `{ kind: "csv-import", newTransactionIds }` after import.

- [ ] **Step 1: Write the failing scheduler test**

`src/lib/notifications/scheduler.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cron from "node-cron";
import { prisma } from "@/lib/prisma";
import { runRules } from "./engine";
import { _resetSchedulerForTests, startNotificationScheduler, sweep } from "./scheduler";

vi.mock("node-cron", () => ({
  default: { schedule: vi.fn(() => ({ stop: vi.fn() })) },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { notificationRule: { findMany: vi.fn() } },
}));
vi.mock("./engine", () => ({ runRules: vi.fn() }));

beforeEach(() => vi.clearAllMocks());
afterEach(() => _resetSchedulerForTests());

describe("startNotificationScheduler", () => {
  it("registers a single 15-minute cron task, idempotently", async () => {
    await startNotificationScheduler();
    await startNotificationScheduler();
    expect(cron.schedule).toHaveBeenCalledOnce();
    expect(vi.mocked(cron.schedule).mock.calls[0][0]).toBe("*/15 * * * *");
  });
});

describe("sweep", () => {
  it("runs sweep-mode rules once per user with enabled rules", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([
      { userId: "u1" }, { userId: "u2" },
    ] as never);
    await sweep();
    expect(runRules).toHaveBeenCalledTimes(2);
    expect(runRules).toHaveBeenCalledWith("u1", { mode: "sweep" });
    expect(runRules).toHaveBeenCalledWith("u2", { mode: "sweep" });
  });

  it("continues past one user's failure", async () => {
    vi.mocked(prisma.notificationRule.findMany).mockResolvedValue([
      { userId: "u1" }, { userId: "u2" },
    ] as never);
    vi.mocked(runRules).mockRejectedValueOnce(new Error("boom"));
    await sweep();
    expect(runRules).toHaveBeenCalledTimes(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/notifications/scheduler.test.ts`
Expected: FAIL — `sweep` / `_resetSchedulerForTests` not exported by the stub.

- [ ] **Step 3: Replace the stub**

`src/lib/notifications/scheduler.ts`:

```ts
import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "@/lib/prisma";
import { runRules } from "./engine";

let started = false;
let task: ScheduledTask | null = null;

/** One global sweep every 15 minutes. Time-based triggers self-gate via
 *  dedupe keys, so re-running is cheap and safe. */
export async function startNotificationScheduler(): Promise<void> {
  if (started) return;
  started = true;
  task = cron.schedule("*/15 * * * *", async () => {
    try {
      await sweep();
    } catch (e) {
      // Never let a sweep failure take the timer down.
      console.error("[notifications] sweep failed:", e);
    }
  });
  console.log("[notifications] scheduler started (sweep every 15 minutes)");
}

export async function sweep(): Promise<void> {
  const users = await prisma.notificationRule.findMany({
    where: { enabled: true },
    select: { userId: true },
    distinct: ["userId"],
  });
  for (const { userId } of users) {
    try {
      await runRules(userId, { mode: "sweep" });
    } catch (e) {
      console.error(`[notifications] sweep failed for user ${userId}:`, e);
    }
  }
}

export function _resetSchedulerForTests(): void {
  task?.stop();
  task = null;
  started = false;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/notifications/scheduler.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Hook Plaid sync success (`src/lib/plaid-sync.ts`)**

Next to the `const result: SyncResult = ...` declaration (line ~217), add:

```ts
  const newTxnIds: string[] = [];
```

In the ADDED loop, change the upsert call (line ~298) to capture the row and collect its id:

```ts
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
```

(Re-delivered transactions land in `newTxnIds` too; per-transaction dedupe keys absorb the refire.)

In the success tail (line ~469), reset the failure streak and fire event rules:

```ts
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
```

- [ ] **Step 6: Hook Plaid sync failure (`src/app/api/plaid/sync/[itemId]/route.ts`)**

Replace the catch block:

```ts
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    console.error("Plaid sync error:", e);
    // Persist the error so the UI can surface it.
    const updated = await prisma.plaidItem.update({
      where: { id: itemId },
      data: { error: msg, failureCount: { increment: 1 } },
    });
    try {
      const { runRules } = await import("@/lib/notifications/engine");
      await runRules(session.user.id, {
        mode: "event",
        event: {
          kind: "plaid-sync-failed",
          plaidItemId: itemId,
          reauthRequired: msg.includes("ITEM_LOGIN_REQUIRED"),
          failureCount: updated.failureCount,
          newTransactionIds: [],
        },
      });
    } catch (hookErr) {
      console.error("[notifications] sync-failure rules failed:", hookErr);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
```

- [ ] **Step 7: Hook CSV import (`src/actions/import.ts`)**

In `commitImportAction`, change the `createMany` call to `createManyAndReturn` and fire event rules after `matchTransfers`:

```ts
    const created = await prisma.transaction.createManyAndReturn({
      data: rows.map((r) => ({
        userId,
        accountId: accountId || null,
        categoryId: r.categoryId && validCatIds.has(r.categoryId) ? r.categoryId : null,
        type: r.type as TxnType,
        amount: r.amount,
        date: parseISODay(r.date),
        description: r.description,
        cleared: true,
      })),
      select: { id: true },
    });

    // Imported CC payments pair up the same way Plaid-synced ones do.
    await matchTransfers(userId);

    // Fire event-mode notification rules with the imported ids. Non-fatal.
    try {
      const { runRules } = await import("@/lib/notifications/engine");
      await runRules(userId, {
        mode: "event",
        event: { kind: "csv-import", newTransactionIds: created.map((t) => t.id) },
      });
    } catch (e) {
      console.error("[notifications] post-import rules failed:", e);
    }
```

(Keep the existing `revalidatePath` calls that follow.)

- [ ] **Step 8: Typecheck and full test run**

```bash
npx tsc --noEmit && npm test
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add src/lib/notifications/scheduler.ts src/lib/notifications/scheduler.test.ts src/lib/plaid-sync.ts "src/app/api/plaid/sync/[itemId]/route.ts" src/actions/import.ts
git commit -m "feat: notification sweep scheduler and sync/import event hooks"
```

---

### Task 12: Queries + server actions

**Files:**
- Create: `src/lib/queries/notifications.ts`
- Create: `src/actions/notifications.ts`

**Interfaces:**
- Consumes: `runRules` (Task 10), `isValidDiscordWebhookUrl` (Task 4), `TRIGGER_BY_ID` (registry), `requireUser` (`@/lib/session`), `run`/`UserError` (`@/lib/action-result`), `isDemoMode` (`@/lib/demo-guard`).
- Produces (used by the UI tasks):
  - `getNotifications(userId: string, limit?: number): Promise<NotificationDTO[]>` — `NotificationDTO = { id: string; ruleName: string; title: string; body: string; firedAt: string; readAt: string | null; deliveryStatus: string; deliveryError: string | null }`
  - `getUnreadNotificationCount(userId: string): Promise<number>`
  - `getNotificationChannels(userId: string): Promise<ChannelDTO[]>` — `ChannelDTO = { id: string; name: string; kind: string; webhookUrl: string }`
  - `getNotificationRules(userId: string): Promise<RuleDTO[]>` — `RuleDTO = { id: string; name: string; enabled: boolean; trigger: string; params: string; channelId: string | null; templateTitle: string | null; templateBody: string | null }`
  - Actions: `saveChannelAction`, `deleteChannelAction`, `saveRuleAction`, `setRuleEnabledAction`, `deleteRuleAction`, `testRuleAction`, `markReadAction` — all return `Promise<ActionResult>`.

- [ ] **Step 1: Create `src/lib/queries/notifications.ts`**

```ts
import { prisma } from "@/lib/prisma";

export interface NotificationDTO {
  id: string;
  ruleName: string;
  title: string;
  body: string;
  firedAt: string;
  readAt: string | null;
  deliveryStatus: string;
  deliveryError: string | null;
}

export async function getNotifications(userId: string, limit = 50): Promise<NotificationDTO[]> {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { firedAt: "desc" },
    take: limit,
  });
  return rows.map((n) => ({
    id: n.id,
    ruleName: n.ruleName,
    title: n.title,
    body: n.body,
    firedAt: n.firedAt.toISOString(),
    readAt: n.readAt ? n.readAt.toISOString() : null,
    deliveryStatus: n.deliveryStatus,
    deliveryError: n.deliveryError,
  }));
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export interface ChannelDTO {
  id: string;
  name: string;
  kind: string;
  webhookUrl: string;
}

export async function getNotificationChannels(userId: string): Promise<ChannelDTO[]> {
  const rows = await prisma.notificationChannel.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });
  return rows.map((c) => ({ id: c.id, name: c.name, kind: c.kind, webhookUrl: c.webhookUrl }));
}

export interface RuleDTO {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  params: string;
  channelId: string | null;
  templateTitle: string | null;
  templateBody: string | null;
}

export async function getNotificationRules(userId: string): Promise<RuleDTO[]> {
  const rows = await prisma.notificationRule.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    trigger: r.trigger,
    params: r.params,
    channelId: r.channelId,
    templateTitle: r.templateTitle,
    templateBody: r.templateBody,
  }));
}
```

- [ ] **Step 2: Create `src/actions/notifications.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { isValidDiscordWebhookUrl } from "@/lib/notifications/discord";
import { TRIGGER_BY_ID } from "@/lib/notifications/triggers";

export async function saveChannelAction(input: {
  id?: string;
  name: string;
  webhookUrl: string;
}): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const name = input.name.trim();
    if (!name) throw new UserError("Channel name is required.");
    if (!isValidDiscordWebhookUrl(input.webhookUrl)) {
      throw new UserError("That doesn't look like a Discord webhook URL (https://discord.com/api/webhooks/...).");
    }
    if (input.id) {
      const existing = await prisma.notificationChannel.findFirst({ where: { id: input.id, userId } });
      if (!existing) throw new UserError("Channel not found.");
      await prisma.notificationChannel.update({
        where: { id: input.id },
        data: { name, webhookUrl: input.webhookUrl },
      });
    } else {
      await prisma.notificationChannel.create({
        data: { userId, name, kind: "discord", webhookUrl: input.webhookUrl },
      });
    }
    revalidatePath("/notifications");
  });
}

export async function deleteChannelAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.notificationChannel.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Channel not found.");
    // Rules pointing here fall back to in-app only via onDelete: SetNull.
    await prisma.notificationChannel.delete({ where: { id } });
    revalidatePath("/notifications");
  });
}

export async function saveRuleAction(input: {
  id?: string;
  name: string;
  trigger: string;
  params: string;
  channelId: string | null;
  templateTitle: string | null;
  templateBody: string | null;
}): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const name = input.name.trim();
    if (!name) throw new UserError("Rule name is required.");
    const def = TRIGGER_BY_ID.get(input.trigger);
    if (!def) throw new UserError("Unknown trigger.");

    let rawParams: unknown;
    try {
      rawParams = JSON.parse(input.params);
    } catch {
      throw new UserError("Invalid rule parameters.");
    }
    const parsed = def.paramsSchema.safeParse(rawParams);
    if (!parsed.success) {
      throw new UserError(parsed.error.issues[0]?.message ?? "Invalid rule parameters.");
    }
    const params = JSON.stringify(parsed.data);

    if (input.channelId) {
      const channel = await prisma.notificationChannel.findFirst({
        where: { id: input.channelId, userId },
      });
      if (!channel) throw new UserError("Channel not found.");
    }

    const data = {
      name,
      trigger: input.trigger,
      params,
      channelId: input.channelId,
      templateTitle: input.templateTitle?.trim() || null,
      templateBody: input.templateBody?.trim() || null,
    };
    if (input.id) {
      const existing = await prisma.notificationRule.findFirst({ where: { id: input.id, userId } });
      if (!existing) throw new UserError("Rule not found.");
      await prisma.notificationRule.update({ where: { id: input.id }, data });
    } else {
      await prisma.notificationRule.create({ data: { ...data, userId } });
    }
    revalidatePath("/notifications");
  });
}

export async function setRuleEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.notificationRule.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Rule not found.");
    await prisma.notificationRule.update({ where: { id }, data: { enabled } });
    revalidatePath("/notifications");
  });
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.notificationRule.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Rule not found.");
    await prisma.notificationRule.delete({ where: { id } });
    revalidatePath("/notifications");
  });
}

export async function testRuleAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.notificationRule.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Rule not found.");
    const { runRules } = await import("@/lib/notifications/engine");
    const summary = await runRules(userId, { mode: "sweep", ruleId: id, test: true });
    if (summary.failed > 0) {
      throw new UserError("Test fired, but delivery failed - check the inbox entry for the error.");
    }
    revalidatePath("/notifications");
  });
}

export async function markReadAction(ids: string[] | "all"): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await prisma.notification.updateMany({
      where: ids === "all" ? { userId, readAt: null } : { userId, id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
    // The layout renders the sidebar badge, so refresh the whole tree.
    revalidatePath("/", "layout");
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
npx tsc --noEmit
```

Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/lib/queries/notifications.ts src/actions/notifications.ts
git commit -m "feat: notification queries and server actions"
```

---

### Task 13: Sidebar nav item + unread badge

**Files:**
- Modify: `src/components/app-nav.ts`, `src/components/Sidebar.tsx`, `src/components/AppChrome.tsx`, `src/app/(app)/layout.tsx`

**Interfaces:**
- Consumes: `getUnreadNotificationCount` (Task 12).
- Produces: `SidebarProps.unreadCount?: number`, `AppChrome` prop `unreadCount?: number`, nav entry `/notifications`.

- [ ] **Step 1: Add the nav entry (`src/components/app-nav.ts`)**

Add `Bell` to the lucide-react import:

```ts
import {
  LayoutDashboard, CalendarDays, Receipt, Landmark, Repeat, Tags, LineChart,
  Settings, PiggyBank, Target, TrendingDown, Wallet, Bell,
} from "lucide-react";
```

Add the entry to `NAV` after Calendar:

```ts
  { href: "/notifications", label: "Notifications", icon: Bell, group: "overview" as NavGroupId },
```

(`mergeNavOrder` auto-appends unknown hrefs, so users with a stored order pick it up without migration.)

- [ ] **Step 2: Add the badge to `src/components/Sidebar.tsx`**

Add to `SidebarProps`:

```ts
  /** Unread notification count for the /notifications badge. */
  unreadCount?: number;
```

Destructure it in the component signature with a default:

```ts
  unreadCount = 0,
```

In `renderItem`, immediately before the GripVertical line (`{!compact && <GripVertical ...`), insert:

```tsx
          {item.href === "/notifications" && unreadCount > 0 && !compact && (
            <span className="rounded-full bg-brand/15 px-1.5 py-0.5 text-[10px] font-semibold text-brand">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
          {item.href === "/notifications" && unreadCount > 0 && compact && (
            <span aria-hidden className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-brand" />
          )}
```

- [ ] **Step 3: Thread the count through `src/components/AppChrome.tsx`**

Add to the destructured props and the props type:

```ts
  unreadCount = 0,
```

```ts
  unreadCount?: number;
```

Add to the `sidebarProps` object (next to `demoMode,`):

```ts
    unreadCount,
```

- [ ] **Step 4: Fetch the count in `src/app/(app)/layout.tsx`**

Add the import:

```ts
import { getUnreadNotificationCount } from "@/lib/queries/notifications";
```

Change the real-user branch to:

```ts
  const ctx = await requireUser();
  const [accounts, categories, unreadCount] = await Promise.all([
    getAccounts(ctx.userId),
    getCategories(ctx.userId),
    getUnreadNotificationCount(ctx.userId),
  ]);

  return (
    <AppChrome
      user={{ name: ctx.name, email: ctx.email, image: ctx.image }}
      accounts={accounts}
      categories={categories}
      authBypass={process.env.AUTH_BYPASS === "true"}
      unreadCount={unreadCount}
    >
      <AutoPlaidSync />
      {children}
    </AppChrome>
  );
```

(The demo branch stays as is - `unreadCount` defaults to 0.)

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit && npm run build
```

Expected: clean build. `/notifications` 404s until the next task - that's fine.

- [ ] **Step 6: Commit**

```bash
git add src/components/app-nav.ts src/components/Sidebar.tsx src/components/AppChrome.tsx "src/app/(app)/layout.tsx"
git commit -m "feat: notifications nav item with unread badge"
```

---

### Task 14: Notifications page + inbox

**Files:**
- Create: `src/app/(app)/notifications/page.tsx`, `NotificationCenter.tsx`, `InboxList.tsx`

**Interfaces:**
- Consumes: queries from Task 12, `TRIGGERS`/`TRIGGER_GROUPS` (registry), `markReadAction` (Task 12), `PageHeader` from `@/components/ui-bits`.
- Produces: `TriggerMeta` type (exported from `NotificationCenter.tsx`, consumed by Task 15's editor):

```ts
export interface TriggerMeta {
  id: string;
  label: string;
  description: string;
  group: string;
  paramFields: ParamField[];
  variables: { name: string; description: string }[];
  defaultTemplate: { title: string; body: string };
}
```

- and `OptionItem = { id: string; name: string }` for account/category selects. `NotificationCenter` props: `{ notifications, rules, channels, triggers, groups, accounts, categories }`.
- `RulesPanel` (Task 15) is referenced here; create a placeholder in this task that Task 15 replaces.

- [ ] **Step 1: Create `src/app/(app)/notifications/page.tsx`**

```tsx
import { requireUser } from "@/lib/session";
import { PageHeader } from "@/components/ui-bits";
import { getAccounts, getCategories } from "@/lib/queries";
import {
  getNotificationChannels,
  getNotificationRules,
  getNotifications,
} from "@/lib/queries/notifications";
import { TRIGGERS, TRIGGER_GROUPS } from "@/lib/notifications/triggers";
import { NotificationCenter, type TriggerMeta } from "./NotificationCenter";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  if (DEMO_MODE) {
    return (
      <div className="stagger mx-auto max-w-3xl space-y-5">
        <PageHeader title="Notifications" subtitle="Demo mode - notifications are disabled." />
        <section className="card p-5">
          <p className="text-sm text-muted">
            The notification center needs a real server and database. In the live demo it is
            read-only and empty.
          </p>
        </section>
      </div>
    );
  }

  const { userId } = await requireUser();
  const [notifications, rules, channels, accounts, categories] = await Promise.all([
    getNotifications(userId),
    getNotificationRules(userId),
    getNotificationChannels(userId),
    getAccounts(userId),
    getCategories(userId),
  ]);

  const triggers: TriggerMeta[] = TRIGGERS.map((t) => ({
    id: t.id,
    label: t.label,
    description: t.description,
    group: t.group,
    paramFields: t.paramFields,
    variables: t.variables,
    defaultTemplate: t.defaultTemplate,
  }));

  return (
    <div className="stagger mx-auto max-w-3xl space-y-5">
      <PageHeader title="Notifications" subtitle="Inbox, rules, and Discord delivery." />
      <NotificationCenter
        notifications={notifications}
        rules={rules}
        channels={channels}
        triggers={triggers}
        groups={TRIGGER_GROUPS}
        accounts={accounts.map((a) => ({ id: a.id, name: a.name }))}
        categories={categories.map((c) => ({ id: c.id, name: c.name }))}
      />
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/(app)/notifications/NotificationCenter.tsx`**

```tsx
"use client";

import { useState } from "react";
import type { ChannelDTO, NotificationDTO, RuleDTO } from "@/lib/queries/notifications";
import type { ParamField } from "@/lib/notifications/types";
import { InboxList } from "./InboxList";
import { RulesPanel } from "./RulesPanel";

export interface TriggerMeta {
  id: string;
  label: string;
  description: string;
  group: string;
  paramFields: ParamField[];
  variables: { name: string; description: string }[];
  defaultTemplate: { title: string; body: string };
}

export interface OptionItem {
  id: string;
  name: string;
}

export function NotificationCenter({
  notifications,
  rules,
  channels,
  triggers,
  groups,
  accounts,
  categories,
}: {
  notifications: NotificationDTO[];
  rules: RuleDTO[];
  channels: ChannelDTO[];
  triggers: TriggerMeta[];
  groups: { id: string; label: string }[];
  accounts: OptionItem[];
  categories: OptionItem[];
}) {
  const [tab, setTab] = useState<"inbox" | "rules">("inbox");
  const unread = notifications.filter((n) => !n.readAt).length;

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg border border-line bg-surface2 p-1 text-sm font-medium">
        {(
          [
            ["inbox", unread > 0 ? `Inbox (${unread})` : "Inbox"],
            ["rules", "Rules"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex-1 rounded-md px-3 py-1.5 transition-colors ${
              tab === id ? "bg-brand/10 text-brand" : "text-muted hover:text-text"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "inbox" ? (
        <InboxList notifications={notifications} />
      ) : (
        <RulesPanel
          rules={rules}
          channels={channels}
          triggers={triggers}
          groups={groups}
          accounts={accounts}
          categories={categories}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/notifications/InboxList.tsx`**

```tsx
"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { BellOff, CheckCheck } from "lucide-react";
import type { NotificationDTO } from "@/lib/queries/notifications";
import { markReadAction } from "@/actions/notifications";

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export function InboxList({ notifications }: { notifications: NotificationDTO[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const markRead = (ids: string[] | "all") =>
    startTransition(async () => {
      await markReadAction(ids);
      router.refresh();
    });

  if (notifications.length === 0) {
    return (
      <div className="card flex flex-col items-center gap-2 p-10 text-center text-muted">
        <BellOff size={22} />
        <p className="text-sm">Nothing yet. Fired rules land here.</p>
      </div>
    );
  }

  const hasUnread = notifications.some((n) => !n.readAt);

  return (
    <div className="space-y-3">
      {hasUnread && (
        <div className="flex justify-end">
          <button onClick={() => markRead("all")} disabled={pending} className="btn-ghost text-xs text-muted">
            <CheckCheck size={14} /> Mark all read
          </button>
        </div>
      )}
      <div className="card divide-y divide-line">
        {notifications.map((n) => {
          const unread = !n.readAt;
          return (
            <button
              key={n.id}
              onClick={() => unread && markRead([n.id])}
              className={`block w-full px-4 py-3 text-left transition-colors ${
                unread ? "bg-brand/5 hover:bg-brand/10" : "hover:bg-surface2"
              }`}
            >
              <div className="flex items-start gap-2">
                {unread && <span aria-hidden className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-brand" />}
                <div className="min-w-0 flex-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <p className={`truncate text-sm ${unread ? "font-semibold" : "font-medium"}`}>{n.title}</p>
                    <span className="shrink-0 text-xs text-muted">{timeAgo(n.firedAt)}</span>
                  </div>
                  <p className="mt-0.5 whitespace-pre-line text-sm text-muted">{n.body}</p>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-muted">
                    <span>{n.ruleName}</span>
                    {n.deliveryStatus === "sent" && <span>· sent to Discord</span>}
                    {n.deliveryStatus === "failed" && (
                      <span className="text-warning">· delivery failed: {n.deliveryError}</span>
                    )}
                  </div>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Create a placeholder `src/app/(app)/notifications/RulesPanel.tsx`**

(Replaced with the real panel in the next task; exists so this task builds.)

```tsx
"use client";

import type { ChannelDTO, RuleDTO } from "@/lib/queries/notifications";
import type { OptionItem, TriggerMeta } from "./NotificationCenter";

export function RulesPanel(_props: {
  rules: RuleDTO[];
  channels: ChannelDTO[];
  triggers: TriggerMeta[];
  groups: { id: string; label: string }[];
  accounts: OptionItem[];
  categories: OptionItem[];
}) {
  return <div className="card p-5 text-sm text-muted">Rules UI lands in the next task.</div>;
}
```

- [ ] **Step 5: Verify**

```bash
npx tsc --noEmit && npm run build
```

Expected: clean. Manual check if a dev server is handy: `/notifications` shows the inbox empty state and tabs.

- [ ] **Step 6: Commit**

```bash
git add "src/app/(app)/notifications"
git commit -m "feat: notifications page with inbox tab"
```

---

### Task 15: Rules panel, rule editor, channels

**Files:**
- Modify: `src/app/(app)/notifications/RulesPanel.tsx` (replace placeholder)
- Create: `src/app/(app)/notifications/RuleEditor.tsx`, `src/app/(app)/notifications/ChannelsPanel.tsx`

**Interfaces:**
- Consumes: `saveRuleAction`, `setRuleEnabledAction`, `deleteRuleAction`, `testRuleAction`, `saveChannelAction`, `deleteChannelAction` (Task 12); `TriggerMeta`/`OptionItem` (Task 14); `ParamField` (Task 3).
- Produces: final `/notifications` Rules tab.

- [ ] **Step 1: Replace `src/app/(app)/notifications/RulesPanel.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Plus, Send, Trash2 } from "lucide-react";
import type { ChannelDTO, RuleDTO } from "@/lib/queries/notifications";
import { deleteRuleAction, setRuleEnabledAction, testRuleAction } from "@/actions/notifications";
import type { OptionItem, TriggerMeta } from "./NotificationCenter";
import { RuleEditor } from "./RuleEditor";
import { ChannelsPanel } from "./ChannelsPanel";

export function RulesPanel({
  rules,
  channels,
  triggers,
  groups,
  accounts,
  categories,
}: {
  rules: RuleDTO[];
  channels: ChannelDTO[];
  triggers: TriggerMeta[];
  groups: { id: string; label: string }[];
  accounts: OptionItem[];
  categories: OptionItem[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState<RuleDTO | "new" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [testedId, setTestedId] = useState<string | null>(null);

  const triggerById = new Map(triggers.map((t) => [t.id, t]));

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    startTransition(async () => {
      setError(null);
      const res = await fn();
      if (!res.ok) setError(res.error ?? "Something went wrong.");
      router.refresh();
    });

  return (
    <div className="space-y-4">
      {error && (
        <p className="rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-warning">{error}</p>
      )}

      <div className="flex justify-end">
        <button onClick={() => setEditing("new")} className="btn-primary text-sm">
          <Plus size={15} /> Add rule
        </button>
      </div>

      {rules.length === 0 && (
        <div className="card p-8 text-center text-sm text-muted">
          No rules yet. Add one to start getting notified.
        </div>
      )}

      {groups.map((group) => {
        const groupRules = rules.filter((r) => triggerById.get(r.trigger)?.group === group.id);
        if (groupRules.length === 0) return null;
        return (
          <div key={group.id}>
            <p className="mb-1 px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted/80">
              {group.label}
            </p>
            <div className="card divide-y divide-line">
              {groupRules.map((rule) => {
                const meta = triggerById.get(rule.trigger);
                const channel = channels.find((c) => c.id === rule.channelId);
                return (
                  <div key={rule.id} className="flex items-center gap-3 px-4 py-3">
                    <label className="flex cursor-pointer items-center">
                      <input
                        type="checkbox"
                        checked={rule.enabled}
                        disabled={pending}
                        onChange={(e) => act(() => setRuleEnabledAction(rule.id, e.target.checked))}
                        className="h-4 w-4 accent-current"
                        aria-label={`Enable ${rule.name}`}
                      />
                    </label>
                    <div className="min-w-0 flex-1">
                      <p className={`truncate text-sm font-medium ${rule.enabled ? "" : "text-muted"}`}>
                        {rule.name}
                      </p>
                      <p className="truncate text-xs text-muted">
                        {meta?.label ?? rule.trigger} · {channel ? `Discord: ${channel.name}` : "In-app only"}
                      </p>
                    </div>
                    <button
                      onClick={() => {
                        setTestedId(null);
                        act(async () => {
                          const res = await testRuleAction(rule.id);
                          if (res.ok) setTestedId(rule.id);
                          return res;
                        });
                      }}
                      disabled={pending}
                      className="btn-ghost h-8 px-2 text-xs text-muted"
                      title="Send a test notification"
                    >
                      <Send size={13} /> {testedId === rule.id ? "Sent" : "Test"}
                    </button>
                    <button
                      onClick={() => setEditing(rule)}
                      className="btn-ghost h-8 w-8 p-0!"
                      title="Edit rule"
                      aria-label={`Edit ${rule.name}`}
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => {
                        if (confirm(`Delete rule "${rule.name}"? Its history stays in the inbox.`)) {
                          act(() => deleteRuleAction(rule.id));
                        }
                      }}
                      disabled={pending}
                      className="btn-ghost h-8 w-8 p-0! text-muted"
                      title="Delete rule"
                      aria-label={`Delete ${rule.name}`}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      <ChannelsPanel channels={channels} />

      {editing && (
        <RuleEditor
          rule={editing === "new" ? null : editing}
          triggers={triggers}
          groups={groups}
          channels={channels}
          accounts={accounts}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Create `src/app/(app)/notifications/RuleEditor.tsx`**

```tsx
"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import type { ChannelDTO, RuleDTO } from "@/lib/queries/notifications";
import type { ParamField } from "@/lib/notifications/types";
import { saveRuleAction } from "@/actions/notifications";
import type { OptionItem, TriggerMeta } from "./NotificationCenter";

export function RuleEditor({
  rule,
  triggers,
  groups,
  channels,
  accounts,
  categories,
  onClose,
}: {
  rule: RuleDTO | null;
  triggers: TriggerMeta[];
  groups: { id: string; label: string }[];
  channels: ChannelDTO[];
  accounts: OptionItem[];
  categories: OptionItem[];
  onClose: () => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const [triggerId, setTriggerId] = useState(rule?.trigger ?? triggers[0]?.id ?? "");
  const [name, setName] = useState(rule?.name ?? "");
  const [channelId, setChannelId] = useState(rule?.channelId ?? "");
  const [customMessage, setCustomMessage] = useState(!!(rule?.templateTitle || rule?.templateBody));
  const meta = triggers.find((t) => t.id === triggerId);
  const [templateTitle, setTemplateTitle] = useState(rule?.templateTitle ?? "");
  const [templateBody, setTemplateBody] = useState(rule?.templateBody ?? "");
  const [params, setParams] = useState<Record<string, string>>(() => {
    try {
      const raw = JSON.parse(rule?.params ?? "{}") as Record<string, unknown>;
      return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, String(v)]));
    } catch {
      return {};
    }
  });

  const grouped = useMemo(
    () => groups.map((g) => ({ ...g, triggers: triggers.filter((t) => t.group === g.id) })),
    [groups, triggers],
  );

  const pickTrigger = (id: string) => {
    setTriggerId(id);
    setParams({});
  };

  const optionsFor = (field: ParamField): { value: string; label: string }[] => {
    if (field.optionsFrom === "account") return accounts.map((a) => ({ value: a.id, label: a.name }));
    if (field.optionsFrom === "category") return categories.map((c) => ({ value: c.id, label: c.name }));
    return field.options ?? [];
  };

  // Digest's weekday/hour selects carry numeric values; every other select stays a string.
  const NUMERIC_SELECT_KEYS = new Set(["weekday", "hour"]);

  const buildParamsJSON = (): string => {
    if (!meta) return "{}";
    const out: Record<string, unknown> = {};
    for (const field of meta.paramFields) {
      const raw = params[field.key];
      if (raw === undefined || raw === "") continue;
      out[field.key] =
        field.kind === "number" || NUMERIC_SELECT_KEYS.has(field.key) ? Number(raw) : raw;
    }
    return JSON.stringify(out);
  };

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await saveRuleAction({
        id: rule?.id,
        name: name || meta?.label || "Rule",
        trigger: triggerId,
        params: buildParamsJSON(),
        channelId: channelId || null,
        templateTitle: customMessage ? templateTitle || null : null,
        templateBody: customMessage ? templateBody || null : null,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.refresh();
      onClose();
    });

  const insertVar = (varName: string) => {
    setTemplateBody((b) => `${b}{{${varName}}}`);
    setCustomMessage(true);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="card max-h-[90vh] w-full max-w-lg overflow-y-auto p-5"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={rule ? "Edit rule" : "Add rule"}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="font-semibold">{rule ? "Edit rule" : "Add rule"}</h2>
          <button onClick={onClose} className="btn-ghost h-8 w-8 p-0!" aria-label="Close">
            <X size={16} />
          </button>
        </div>

        {error && (
          <p className="mb-3 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-warning">{error}</p>
        )}

        <div className="space-y-4">
          <label className="block text-sm">
            <span className="mb-1 block font-medium">Trigger</span>
            <select
              value={triggerId}
              onChange={(e) => pickTrigger(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface2 px-3 py-2"
            >
              {grouped.map((g) =>
                g.triggers.length ? (
                  <optgroup key={g.id} label={g.label}>
                    {g.triggers.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.label}
                      </option>
                    ))}
                  </optgroup>
                ) : null,
              )}
            </select>
            {meta && <span className="mt-1 block text-xs text-muted">{meta.description}</span>}
          </label>

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Rule name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={meta?.label ?? "My rule"}
              className="w-full rounded-lg border border-line bg-surface2 px-3 py-2"
            />
          </label>

          {meta && meta.paramFields.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {meta.paramFields.map((field) => (
                <label key={field.key} className="block text-sm">
                  <span className="mb-1 block font-medium">{field.label}</span>
                  {field.kind === "number" ? (
                    <input
                      type="number"
                      min={field.min}
                      max={field.max}
                      step={field.step ?? 1}
                      value={params[field.key] ?? ""}
                      onChange={(e) => setParams((p) => ({ ...p, [field.key]: e.target.value }))}
                      className="w-full rounded-lg border border-line bg-surface2 px-3 py-2"
                    />
                  ) : (
                    <select
                      value={params[field.key] ?? ""}
                      onChange={(e) => setParams((p) => ({ ...p, [field.key]: e.target.value }))}
                      className="w-full rounded-lg border border-line bg-surface2 px-3 py-2"
                    >
                      {field.optional !== false && <option value="">{field.optionsFrom ? "All" : "Default"}</option>}
                      {optionsFor(field).map((o) => (
                        <option key={o.value} value={o.value}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                  )}
                  {field.help && <span className="mt-1 block text-xs text-muted">{field.help}</span>}
                </label>
              ))}
            </div>
          )}

          <label className="block text-sm">
            <span className="mb-1 block font-medium">Deliver to</span>
            <select
              value={channelId}
              onChange={(e) => setChannelId(e.target.value)}
              className="w-full rounded-lg border border-line bg-surface2 px-3 py-2"
            >
              <option value="">In-app only</option>
              {channels.map((c) => (
                <option key={c.id} value={c.id}>
                  Discord: {c.name}
                </option>
              ))}
            </select>
          </label>

          <div className="rounded-lg border border-line p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={customMessage}
                onChange={(e) => setCustomMessage(e.target.checked)}
                className="h-4 w-4 accent-current"
              />
              Custom message
            </label>
            {customMessage && meta && (
              <div className="mt-3 space-y-2">
                <input
                  value={templateTitle}
                  onChange={(e) => setTemplateTitle(e.target.value)}
                  placeholder={meta.defaultTemplate.title}
                  className="w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm"
                  aria-label="Custom title"
                />
                <textarea
                  value={templateBody}
                  onChange={(e) => setTemplateBody(e.target.value)}
                  placeholder={meta.defaultTemplate.body}
                  rows={3}
                  className="w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm"
                  aria-label="Custom body"
                />
                <div className="flex flex-wrap gap-1">
                  {meta.variables.map((v) => (
                    <button
                      key={v.name}
                      type="button"
                      onClick={() => insertVar(v.name)}
                      title={v.description}
                      className="rounded border border-line bg-surface2 px-1.5 py-0.5 font-mono text-[11px] text-muted hover:text-text"
                    >
                      {`{{${v.name}}}`}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-2">
            <button onClick={onClose} className="btn-ghost text-sm">
              Cancel
            </button>
            <button onClick={save} disabled={pending} className="btn-primary text-sm">
              {pending ? "Saving..." : "Save rule"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Create `src/app/(app)/notifications/ChannelsPanel.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2 } from "lucide-react";
import type { ChannelDTO } from "@/lib/queries/notifications";
import { deleteChannelAction, saveChannelAction } from "@/actions/notifications";

export function ChannelsPanel({ channels }: { channels: ChannelDTO[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [error, setError] = useState<string | null>(null);

  const save = () =>
    startTransition(async () => {
      setError(null);
      const res = await saveChannelAction({ name, webhookUrl });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setAdding(false);
      setName("");
      setWebhookUrl("");
      router.refresh();
    });

  const remove = (channel: ChannelDTO) =>
    startTransition(async () => {
      if (!confirm(`Delete channel "${channel.name}"? Rules using it become in-app only.`)) return;
      await deleteChannelAction(channel.id);
      router.refresh();
    });

  return (
    <div className="card p-4">
      <div className="mb-2 flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold">Channels</h3>
          <p className="text-xs text-muted">Named Discord webhooks rules can deliver to.</p>
        </div>
        {!adding && (
          <button onClick={() => setAdding(true)} className="btn-ghost text-xs">
            <Plus size={13} /> Add channel
          </button>
        )}
      </div>

      {channels.length === 0 && !adding && (
        <p className="text-sm text-muted">No channels yet - rules deliver in-app only.</p>
      )}

      <div className="divide-y divide-line">
        {channels.map((c) => (
          <div key={c.id} className="flex items-center gap-3 py-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{c.name}</p>
              <p className="truncate font-mono text-[11px] text-muted">{c.webhookUrl}</p>
            </div>
            <button
              onClick={() => remove(c)}
              disabled={pending}
              className="btn-ghost h-8 w-8 p-0! text-muted"
              title="Delete channel"
              aria-label={`Delete ${c.name}`}
            >
              <Trash2 size={14} />
            </button>
          </div>
        ))}
      </div>

      {adding && (
        <div className="mt-2 space-y-2 border-t border-line pt-3">
          {error && <p className="text-sm text-warning">{error}</p>}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Channel name (e.g. budget-alerts)"
            className="w-full rounded-lg border border-line bg-surface2 px-3 py-2 text-sm"
            aria-label="Channel name"
          />
          <input
            value={webhookUrl}
            onChange={(e) => setWebhookUrl(e.target.value)}
            placeholder="https://discord.com/api/webhooks/..."
            className="w-full rounded-lg border border-line bg-surface2 px-3 py-2 font-mono text-sm"
            aria-label="Webhook URL"
          />
          <div className="flex justify-end gap-2">
            <button onClick={() => setAdding(false)} className="btn-ghost text-xs">
              Cancel
            </button>
            <button onClick={save} disabled={pending} className="btn-primary text-xs">
              {pending ? "Saving..." : "Save channel"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Verify**

```bash
npx tsc --noEmit && npm run build && npm test
```

Expected: all pass. Manual smoke test if a dev server is handy: add a channel with a bogus URL (rejected), add a rule, hit Test, see the inbox row.

- [ ] **Step 5: Commit**

```bash
git add "src/app/(app)/notifications"
git commit -m "feat: notification rules panel, rule editor, and channels"
```

---

### Task 16: Docs cleanup

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Update README**

Find the ntfy/alert digest mentions (lines ~38, ~119, ~556 - grep for `ntfy` and `alert`):

```bash
grep -n -i "ntfy\|alert" README.md
```

Replace each mention of the old scheduled digest / ntfy alerts with the new system. Feature-list line (~38) becomes:

```markdown
- **Notification center** - rule-based notifications (connection health, budgets, bills, transactions, scheduled digest) with an in-app inbox and optional Discord webhook delivery with custom message templates
```

Where the README documents the settings-page alert configuration (~119 and ~556), replace with:

```markdown
### Notifications

Notifications live at **Notifications** in the sidebar (not Settings). Each rule pairs a
trigger (bank connection needs relinking, budget exceeded, bill due, large transaction,
scheduled digest, and more) with an optional Discord webhook channel and an optional
custom message template using `{{variables}}`. Every fired rule lands in the in-app
inbox; the sidebar bell shows an unread badge.

Time-based triggers run on an in-process sweep every 15 minutes, so they need an
always-on / self-hosted deployment (like scheduled backups). Transaction triggers fire
immediately after a Plaid sync or CSV import.
```

Adjust surrounding prose so nothing still claims ntfy or generic webhook support.

- [ ] **Step 2: Final verification**

```bash
npx tsc --noEmit && npm run build && npm test
```

Expected: all pass.

- [ ] **Step 3: Commit**

```bash
git add README.md
git commit -m "docs: document the notification center"
```
