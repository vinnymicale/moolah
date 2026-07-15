# Transaction Tags Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Free-form colored tags on transactions: manual tagging (edit modal + bulk bar), tag filtering with totals on /transactions, rule-based auto-tagging, and a Tags management tab on /categories.

**Architecture:** New `Tag` model with an implicit Prisma many-to-many join to `Transaction`. Tags flow through the existing DTO/filter pipeline (`TransactionDTO`, `TransactionFilters`, URL params) and the existing rules engine gains an additive `addTag` action applied in Plaid sync, CSV import, and the apply-to-existing backfill. Management UI is a new `TagsManager` client component behind a `?tab=tags` switch on /categories.

**Tech Stack:** Next.js App Router (server components + "use server" actions), Prisma/PostgreSQL (generated client at `@/generated/prisma`), Zod, Vitest, Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-14-transaction-tags-design.md`. Read it before starting if anything here is unclear.
- Every mutating server action starts with `if (isDemoMode()) return { ok: true };` (matching the action's success shape) before `run()`.
- Tag name rules (spec, verbatim): trimmed, inner whitespace collapsed, matched case-insensitively on create and lookup, displayed as first typed, max length 40 characters, empty names rejected.
- Tag default color is `"#64748b"`; the picker uses `COLOR_PALETTE` from `src/lib/colors.ts`.
- Filter semantics are OR: a transaction matches if it has ANY selected tag.
- Prisma gotchas this plan works around everywhere: `updateMany` and `createManyAndReturn` cannot touch many-to-many relations (use per-row `update`/`create` with `tags: { connect }` inside `prisma.$transaction` or loops), and `connect` on an already-connected implicit m2m pair can violate the join table's unique constraint — always filter to not-yet-connected rows first (`NOT: { tags: { some: { id } } }` or by reading current tag ids).
- The `addTag` rule action is ADDITIVE: every matching rule contributes, ids accumulate and dedup into `RuleEffect.addTagIds`; first-wins does NOT apply. Rules referencing a deleted tag skip the action (enforced at apply sites by filtering against live tag ids).
- Code style: hyphens not em-dashes in user-facing copy, no over-commenting, match surrounding idiom.
- Commits: conventional-commit subject plus a second `-m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"`.
- Test runner: `npx vitest run <file>`; full suite `npm test`. Typecheck: `npx tsc --noEmit` (expected to exit 0 before and after each task).

---

### Task 1: Tag model + migration

**Files:**
- Modify: `prisma/schema.prisma` (User model ~line 57, Transaction model ~line 281, append Tag model)
- Create: `prisma/migrations/<timestamp>_add_tags/migration.sql` (generated)

**Interfaces:**
- Consumes: existing `User` and `Transaction` models.
- Produces: `prisma.tag` client delegate; `Transaction.tags: Tag[]`; join table `_TagToTransaction` with columns `"A"` (Tag id) and `"B"` (Transaction id) — alphabetical by model name.

- [ ] **Step 1: Add the Tag model and relations to the schema**

In the `User` model, directly after the `notificationChannels NotificationChannel[]` relation line, add:

```prisma
  tags                 Tag[]
```

In the `Transaction` model, directly after the `splits TransactionSplit[]` line, add:

```prisma
  tags Tag[]
```

Append at the end of `prisma/schema.prisma`:

```prisma
model Tag {
  id     String @id @default(cuid())
  userId String
  user   User   @relation(fields: [userId], references: [id], onDelete: Cascade)

  name      String
  color     String   @default("#64748b")
  createdAt DateTime @default(now())

  transactions Transaction[]

  @@unique([userId, name])
  @@index([userId])
}
```

Match the column alignment style of the surrounding models.

- [ ] **Step 2: Create the migration**

Run: `npx prisma migrate dev --name add_tags`
Expected: a new folder `prisma/migrations/<timestamp>_add_tags/` containing `CREATE TABLE "Tag"` and `CREATE TABLE "_TagToTransaction"` statements, and "Generated Prisma Client" in the output.

- [ ] **Step 3: Verify typecheck still passes**

Run: `npx tsc --noEmit`
Expected: exits 0, no output.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Tag model with implicit m2m to Transaction" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Tag name normalization + resolver (`src/lib/tags.ts`)

**Files:**
- Create: `src/lib/tags.ts`
- Test: `src/lib/tags.test.ts`

**Interfaces:**
- Consumes: `prisma` from `@/lib/prisma`, `UserError` from `@/lib/action-result`.
- Produces: `DEFAULT_TAG_COLOR = "#64748b"`, `MAX_TAG_NAME_LENGTH = 40`, `normalizeTagName(raw: string): string` (throws `UserError` on empty/too long), `resolveTagIds(userId: string, names: string[]): Promise<string[]>` (case-insensitive resolve, creates missing, dedups input). Used by Tasks 4, 7.

- [ ] **Step 1: Write the failing tests**

Create `src/lib/tags.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { tag: { findMany: vi.fn(), create: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/action-result";
import { normalizeTagName, resolveTagIds, MAX_TAG_NAME_LENGTH } from "./tags";

const findMany = vi.mocked(prisma.tag.findMany);
const create = vi.mocked(prisma.tag.create);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("normalizeTagName", () => {
  it("trims and collapses inner whitespace", () => {
    expect(normalizeTagName("  vacation   2026 ")).toBe("vacation 2026");
  });

  it("rejects empty names", () => {
    expect(() => normalizeTagName("   ")).toThrow(UserError);
  });

  it("rejects names over 40 characters and allows exactly 40", () => {
    expect(() => normalizeTagName("x".repeat(MAX_TAG_NAME_LENGTH + 1))).toThrow(UserError);
    expect(normalizeTagName("x".repeat(MAX_TAG_NAME_LENGTH))).toBe("x".repeat(40));
  });
});

describe("resolveTagIds", () => {
  it("returns [] for empty input without touching the db", async () => {
    expect(await resolveTagIds("u1", [])).toEqual([]);
    expect(findMany).not.toHaveBeenCalled();
  });

  it("resolves an existing tag case-insensitively instead of creating", async () => {
    findMany.mockResolvedValue([{ id: "t1", name: "Vacation" }] as never);
    expect(await resolveTagIds("u1", ["vacation"])).toEqual(["t1"]);
    expect(create).not.toHaveBeenCalled();
  });

  it("creates missing tags with the name as typed", async () => {
    findMany.mockResolvedValue([] as never);
    create.mockResolvedValue({ id: "t2" } as never);
    expect(await resolveTagIds("u1", [" beach   trip "])).toEqual(["t2"]);
    expect(create).toHaveBeenCalledWith({
      data: { userId: "u1", name: "beach trip" },
      select: { id: true },
    });
  });

  it("dedups case-insensitive duplicates in the input", async () => {
    findMany.mockResolvedValue([{ id: "t1", name: "Trip" }] as never);
    expect(await resolveTagIds("u1", ["Trip", "trip"])).toEqual(["t1"]);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/tags.test.ts`
Expected: FAIL — cannot resolve `./tags`.

- [ ] **Step 3: Implement `src/lib/tags.ts`**

```ts
import { prisma } from "@/lib/prisma";
import { UserError } from "@/lib/action-result";

export const DEFAULT_TAG_COLOR = "#64748b";
export const MAX_TAG_NAME_LENGTH = 40;

/** Trim, collapse inner whitespace, enforce the length limit. */
export function normalizeTagName(raw: string): string {
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name) throw new UserError("Tag name is required");
  if (name.length > MAX_TAG_NAME_LENGTH) {
    throw new UserError(`Tag names are limited to ${MAX_TAG_NAME_LENGTH} characters`);
  }
  return name;
}

/**
 * Resolve tag names to ids for one user, matching existing tags
 * case-insensitively and creating any that are missing.
 */
export async function resolveTagIds(userId: string, names: string[]): Promise<string[]> {
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = normalizeTagName(raw);
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    normalized.push(name);
  }
  if (normalized.length === 0) return [];

  const existing = await prisma.tag.findMany({
    where: { userId, name: { in: normalized, mode: "insensitive" } },
    select: { id: true, name: true },
  });
  const byLower = new Map(existing.map((t) => [t.name.toLowerCase(), t.id]));

  const ids: string[] = [];
  for (const name of normalized) {
    const found = byLower.get(name.toLowerCase());
    if (found) {
      ids.push(found);
      continue;
    }
    const created = await prisma.tag.create({ data: { userId, name }, select: { id: true } });
    ids.push(created.id);
  }
  return ids;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/tags.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/tags.ts src/lib/tags.test.ts
git commit -m "feat: tag name normalization and case-insensitive resolver" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Tag queries (`src/lib/queries/tags.ts`)

**Files:**
- Create: `src/lib/queries/tags.ts`
- Modify: `src/lib/queries/index.ts`

**Interfaces:**
- Consumes: `prisma`, `toNumber` from `@/lib/money`.
- Produces: `TagDTO { id: string; name: string; color: string; usageCount: number; totalAmount: number }` and `getTags(userId: string): Promise<TagDTO[]>` (ordered by name asc), exported from the `@/lib/queries` barrel. Used by Tasks 6, 11, 13.

- [ ] **Step 1: Implement the query**

Create `src/lib/queries/tags.ts` (mirrors the style of `src/lib/queries/categories.ts`):

```ts
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";

export interface TagDTO {
  id: string;
  name: string;
  color: string;
  usageCount: number;
  totalAmount: number;
}

export async function getTags(userId: string): Promise<TagDTO[]> {
  const rows = await prisma.tag.findMany({
    where: { userId },
    orderBy: { name: "asc" },
    include: { transactions: { where: { deletedAt: null }, select: { amount: true } } },
  });
  return rows.map((t) => ({
    id: t.id,
    name: t.name,
    color: t.color,
    usageCount: t.transactions.length,
    totalAmount: t.transactions.reduce((sum, x) => sum + toNumber(x.amount), 0),
  }));
}
```

In `src/lib/queries/index.ts`, add alongside the other exports:

```ts
export * from "./tags";
```

- [ ] **Step 2: Verify typecheck**

Run: `npx tsc --noEmit`
Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add src/lib/queries/tags.ts src/lib/queries/index.ts
git commit -m "feat: getTags query with usage count and total amount" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: Tag server actions (`src/actions/tags.ts`)

**Files:**
- Create: `src/actions/tags.ts`
- Test: `src/actions/tags.test.ts`

**Interfaces:**
- Consumes: `normalizeTagName`, `DEFAULT_TAG_COLOR` from `@/lib/tags` (Task 2); `RuleAction` from `@/lib/rules` (the `addTag` variant is added in Task 9 — until then the `a.type === "addTag"` comparisons in `mergeTagsAction` compile because `r.actions` is cast from JSON; cast to `RuleAction[]` exactly as shown below and it compiles both before and after Task 9).
- Produces:
  - `createTagAction(input: { name: string; color?: string }): Promise<{ ok: true; id: string } | { ok: false; error: string }>` — returns the new id so the bulk bar (Task 8) can create-then-apply.
  - `renameTagAction(id: string, name: string): Promise<ActionResult>`
  - `setTagColorAction(id: string, color: string): Promise<ActionResult>`
  - `deleteTagAction(id: string): Promise<ActionResult>`
  - `mergeTagsAction(sourceId: string, targetId: string): Promise<ActionResult>`

- [ ] **Step 1: Write the failing tests**

Create `src/actions/tags.test.ts` (same mock pattern as `src/actions/categories.test.ts`):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    tag: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
    transaction: { findMany: vi.fn(), update: vi.fn() },
    rule: { findMany: vi.fn(), update: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import {
  createTagAction,
  renameTagAction,
  setTagColorAction,
  deleteTagAction,
  mergeTagsAction,
} from "./tags";

const requireUserMock = vi.mocked(requireUser);
const tagFindFirst = vi.mocked(prisma.tag.findFirst);
const tagCreate = vi.mocked(prisma.tag.create);
const tagUpdate = vi.mocked(prisma.tag.update);
const tagDelete = vi.mocked(prisma.tag.delete);
const txnFindMany = vi.mocked(prisma.transaction.findMany);
const ruleFindMany = vi.mocked(prisma.rule.findMany);
const ruleUpdate = vi.mocked(prisma.rule.update);

const owned = { id: "t1", userId: "u1", name: "vacation", color: "#64748b" };

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
  vi.mocked(prisma.$transaction).mockResolvedValue([] as never);
});

describe("createTagAction", () => {
  it("is a no-op in demo mode", async () => {
    demoMode.value = true;
    const res = await createTagAction({ name: "x" });
    expect(res.ok).toBe(true);
    expect(tagCreate).not.toHaveBeenCalled();
  });

  it("normalizes the name and applies the default color", async () => {
    tagFindFirst.mockResolvedValue(null);
    tagCreate.mockResolvedValue({ id: "t9" } as never);
    const res = await createTagAction({ name: "  vacation   2026 " });
    expect(res).toEqual({ ok: true, id: "t9" });
    expect(tagCreate).toHaveBeenCalledWith({
      data: { userId: "u1", name: "vacation 2026", color: "#64748b" },
      select: { id: true },
    });
  });

  it("rejects a case-insensitive duplicate name", async () => {
    tagFindFirst.mockResolvedValue(owned as never);
    const res = await createTagAction({ name: "VACATION" });
    expect(res).toEqual({ ok: false, error: "A tag with that name already exists" });
  });
});

describe("renameTagAction", () => {
  it("errors when the tag is not owned", async () => {
    tagFindFirst.mockResolvedValue(null);
    const res = await renameTagAction("t1", "new");
    expect(res).toEqual({ ok: false, error: "Tag not found" });
  });

  it("rejects renaming onto another tag's name", async () => {
    tagFindFirst.mockResolvedValueOnce(owned as never);
    tagFindFirst.mockResolvedValueOnce({ id: "t2" } as never);
    const res = await renameTagAction("t1", "reimbursable");
    expect(res).toEqual({ ok: false, error: "A tag with that name already exists" });
    expect(tagUpdate).not.toHaveBeenCalled();
  });

  it("renames when the name is free", async () => {
    tagFindFirst.mockResolvedValueOnce(owned as never);
    tagFindFirst.mockResolvedValueOnce(null);
    const res = await renameTagAction("t1", "  new   name ");
    expect(res).toEqual({ ok: true });
    expect(tagUpdate).toHaveBeenCalledWith({ where: { id: "t1" }, data: { name: "new name" } });
  });
});

describe("setTagColorAction", () => {
  it("updates the color on an owned tag", async () => {
    tagFindFirst.mockResolvedValue(owned as never);
    const res = await setTagColorAction("t1", "#dc2626");
    expect(res).toEqual({ ok: true });
    expect(tagUpdate).toHaveBeenCalledWith({ where: { id: "t1" }, data: { color: "#dc2626" } });
  });
});

describe("deleteTagAction", () => {
  it("deletes an owned tag", async () => {
    tagFindFirst.mockResolvedValue(owned as never);
    const res = await deleteTagAction("t1");
    expect(res).toEqual({ ok: true });
    expect(tagDelete).toHaveBeenCalledWith({ where: { id: "t1" } });
  });
});

describe("mergeTagsAction", () => {
  it("rejects merging a tag into itself", async () => {
    const res = await mergeTagsAction("t1", "t1");
    expect(res).toEqual({ ok: false, error: "Pick two different tags" });
  });

  it("re-points transactions, rewrites rules, and deletes the source", async () => {
    tagFindFirst.mockResolvedValue(owned as never);
    txnFindMany.mockResolvedValue([{ id: "x1" }, { id: "x2" }] as never);
    ruleFindMany.mockResolvedValue([
      {
        id: "r1",
        actions: [
          { type: "addTag", tagId: "src" },
          { type: "setCategory", categoryId: "c1" },
        ],
      },
    ] as never);

    const res = await mergeTagsAction("src", "tgt");
    expect(res).toEqual({ ok: true });
    // only transactions NOT already carrying the target get connected
    expect(txnFindMany).toHaveBeenCalledWith({
      where: { userId: "u1", tags: { some: { id: "src" } }, NOT: { tags: { some: { id: "tgt" } } } },
      select: { id: true },
    });
    expect(tagDelete).toHaveBeenCalledWith({ where: { id: "src" } });
    expect(ruleUpdate).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: {
        actions: [
          { type: "addTag", tagId: "tgt" },
          { type: "setCategory", categoryId: "c1" },
        ],
      },
    });
  });

  it("dedups when a rule already adds the target tag", async () => {
    tagFindFirst.mockResolvedValue(owned as never);
    txnFindMany.mockResolvedValue([] as never);
    ruleFindMany.mockResolvedValue([
      {
        id: "r1",
        actions: [
          { type: "addTag", tagId: "src" },
          { type: "addTag", tagId: "tgt" },
        ],
      },
    ] as never);

    await mergeTagsAction("src", "tgt");
    expect(ruleUpdate).toHaveBeenCalledWith({
      where: { id: "r1" },
      data: { actions: [{ type: "addTag", tagId: "tgt" }] },
    });
  });

  it("leaves rules without the source tag untouched", async () => {
    tagFindFirst.mockResolvedValue(owned as never);
    txnFindMany.mockResolvedValue([] as never);
    ruleFindMany.mockResolvedValue([
      { id: "r1", actions: [{ type: "setCategory", categoryId: "c1" }] },
    ] as never);

    await mergeTagsAction("src", "tgt");
    expect(ruleUpdate).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/actions/tags.test.ts`
Expected: FAIL — cannot resolve `./tags`.

- [ ] **Step 3: Implement `src/actions/tags.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { normalizeTagName, DEFAULT_TAG_COLOR } from "@/lib/tags";
import type { RuleAction } from "@/lib/rules";
import type { Prisma } from "@/generated/prisma/client";

const colorSchema = z.string().max(20);

function revalidateTagPages() {
  revalidatePath("/categories");
  revalidatePath("/transactions");
  revalidatePath("/");
}

async function findOwnedTag(userId: string, id: string) {
  const tag = await prisma.tag.findFirst({ where: { id, userId } });
  if (!tag) throw new UserError("Tag not found");
  return tag;
}

async function assertNameFree(userId: string, name: string, excludeId?: string) {
  const clash = await prisma.tag.findFirst({
    where: {
      userId,
      name: { equals: name, mode: "insensitive" },
      ...(excludeId ? { id: { not: excludeId } } : {}),
    },
  });
  if (clash) throw new UserError("A tag with that name already exists");
}

export async function createTagAction(input: {
  name: string;
  color?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  if (isDemoMode()) return { ok: true, id: "demo-tag" };
  try {
    const { userId } = await requireUser();
    const name = normalizeTagName(input.name);
    const color = colorSchema.parse(input.color ?? DEFAULT_TAG_COLOR);
    await assertNameFree(userId, name);
    const tag = await prisma.tag.create({ data: { userId, name, color }, select: { id: true } });
    revalidateTagPages();
    return { ok: true, id: tag.id };
  } catch (e) {
    if (e instanceof UserError) return { ok: false, error: e.message };
    console.error(e);
    return { ok: false, error: "Something went wrong." };
  }
}

export async function renameTagAction(id: string, name: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await findOwnedTag(userId, id);
    const normalized = normalizeTagName(name);
    await assertNameFree(userId, normalized, id);
    await prisma.tag.update({ where: { id }, data: { name: normalized } });
    revalidateTagPages();
  });
}

export async function setTagColorAction(id: string, color: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await findOwnedTag(userId, id);
    await prisma.tag.update({ where: { id }, data: { color: colorSchema.parse(color) } });
    revalidateTagPages();
  });
}

export async function deleteTagAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await findOwnedTag(userId, id);
    await prisma.tag.delete({ where: { id } });
    revalidateTagPages();
  });
}

/**
 * Merge source into target: re-point tagged transactions, rewrite rules that
 * add the source tag, then delete the source (the join rows cascade away).
 */
export async function mergeTagsAction(sourceId: string, targetId: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    if (sourceId === targetId) throw new UserError("Pick two different tags");
    await findOwnedTag(userId, sourceId);
    await findOwnedTag(userId, targetId);

    const toRepoint = await prisma.transaction.findMany({
      where: { userId, tags: { some: { id: sourceId } }, NOT: { tags: { some: { id: targetId } } } },
      select: { id: true },
    });
    await prisma.$transaction([
      ...toRepoint.map((t) =>
        prisma.transaction.update({
          where: { id: t.id },
          data: { tags: { connect: { id: targetId } } },
        }),
      ),
      prisma.tag.delete({ where: { id: sourceId } }),
    ]);

    const rules = await prisma.rule.findMany({ where: { userId } });
    for (const r of rules) {
      const actions = r.actions as unknown as RuleAction[];
      if (!actions.some((a) => a.type === "addTag" && a.tagId === sourceId)) continue;
      const seen = new Set<string>();
      const rewritten = actions
        .map((a) => (a.type === "addTag" && a.tagId === sourceId ? { type: "addTag" as const, tagId: targetId } : a))
        .filter((a) => {
          if (a.type !== "addTag") return true;
          if (seen.has(a.tagId)) return false;
          seen.add(a.tagId);
          return true;
        });
      await prisma.rule.update({
        where: { id: r.id },
        data: { actions: rewritten as unknown as Prisma.InputJsonValue },
      });
    }

    revalidateTagPages();
  });
}
```

Note: `RuleAction` does not yet have an `addTag` variant (Task 9 adds it). If `a.type === "addTag"` fails to compile before Task 9, type the local as `const actions = r.actions as unknown as ({ type: string; tagId?: string } & Record<string, unknown>)[];` temporarily is NOT allowed — instead just do Task 9's two-line type addition to `src/lib/rules.ts` (the `RuleAction` union member and `RuleEffect.addTagIds`) as part of this task's step and note it in the commit; Task 9 then only adds the evaluate case and tests.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/actions/tags.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 5: Commit**

```bash
git add src/actions/tags.ts src/actions/tags.test.ts src/lib/rules.ts
git commit -m "feat: tag CRUD and merge server actions" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Tags on TransactionDTO + tag filters

**Files:**
- Modify: `src/lib/queries/transactions.ts`
- Modify: `src/app/(app)/transactions/transactions-utils.ts`
- Modify: `src/lib/demo-data.ts`
- Test: `src/app/(app)/transactions/transactions-utils.test.ts` (exists — append)

**Interfaces:**
- Consumes: `TagDTO` (Task 3).
- Produces: `TransactionDTO.tags: { id: string; name: string; color: string }[]`; `TransactionFilters.tagIds: string[]`; `parseTransactionFilters` accepts `tag?: string`; `filterTransactionDTOs` applies OR tag matching; `SavedFilter.tags: string[]` (read defensively — older saved filters lack it); `DEMO_TAGS: TagDTO[]` export from `@/lib/demo-data`. Used by Tasks 6, 7, 14.

- [ ] **Step 1: Write the failing tests**

Append to `src/app/(app)/transactions/transactions-utils.test.ts` (reuse the file's existing `TransactionDTO` fixture helper if one exists by extending it with `tags`; otherwise use this local helper inside the new describe block):

```ts
describe("tag filters", () => {
  const tagChip = (id: string) => ({ id, name: id, color: "#64748b" });
  const dtoWithTags = (id: string, tags: { id: string; name: string; color: string }[]): TransactionDTO => ({
    id,
    type: "EXPENSE",
    amount: 10,
    date: "2026-07-01",
    description: "x",
    note: null,
    accountId: null,
    categoryId: null,
    cleared: true,
    isTransfer: false,
    effectiveTransfer: false,
    recurringRuleId: null,
    plaidTransactionId: null,
    splits: [],
    tags,
  });

  it("parses the tag param into tagIds", () => {
    expect(parseTransactionFilters({ tag: "t1, t2" }).tagIds).toEqual(["t1", "t2"]);
    expect(parseTransactionFilters({}).tagIds).toEqual([]);
  });

  it("matches transactions with ANY selected tag (OR)", () => {
    const f = { ...EMPTY_TRANSACTION_FILTERS, tagIds: ["a", "b"] };
    const list = [
      dtoWithTags("m1", [tagChip("a")]),
      dtoWithTags("m2", [tagChip("b"), tagChip("c")]),
      dtoWithTags("m3", [tagChip("c")]),
      dtoWithTags("m4", []),
    ];
    const out = filterTransactionDTOs(list, f, new Map());
    expect(out.map((t) => t.id)).toEqual(["m1", "m2"]);
  });

  it("ignores tags when no tag filter is set", () => {
    const out = filterTransactionDTOs([dtoWithTags("m1", [])], EMPTY_TRANSACTION_FILTERS, new Map());
    expect(out).toHaveLength(1);
  });
});
```

Add whatever imports (`parseTransactionFilters`, `filterTransactionDTOs`, `EMPTY_TRANSACTION_FILTERS`, `TransactionDTO`) the file doesn't already have. If the existing fixture builds `date` as something other than a string, match the existing shape.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run "src/app/(app)/transactions/transactions-utils.test.ts"`
Expected: FAIL — `tagIds` missing from parse result / TS errors on `tags`.

- [ ] **Step 3: Extend `src/lib/queries/transactions.ts`**

Five edits:

1. `TransactionDTO` gains:

```ts
  tags: { id: string; name: string; color: string }[];
```

2. `TransactionFilters` gains `tagIds: string[];` and `EMPTY_TRANSACTION_FILTERS` gains `tagIds: [],`.

3. In `transactionWhere`, alongside the other filter pushes:

```ts
  if (filters.tagIds.length > 0) {
    and.push({ tags: { some: { id: { in: filters.tagIds } } } });
  }
```

4. `TransactionRow` type and BOTH `findMany` include objects (in `getTransactionsBetween` and `getTransactionsPage`) gain the tags selection. The include objects become:

```ts
include: {
  splits: true,
  account: { select: { type: true } },
  tags: { select: { id: true, name: true, color: true } },
},
```

and the `Prisma.TransactionGetPayload<...>` type argument gains the same `tags` entry.

5. `toTransactionDTO` gains:

```ts
    tags: t.tags.map((x) => ({ id: x.id, name: x.name, color: x.color })),
```

- [ ] **Step 4: Extend `src/app/(app)/transactions/transactions-utils.ts`**

1. `parseTransactionFilters` param type gains `tag?: string` and the return gains:

```ts
    tagIds: [...toSet(params.tag ?? "")],
```

2. In `filterTransactionDTOs`, after the accountIds check:

```ts
    if (f.tagIds.length > 0 && !t.tags.some((x) => f.tagIds.includes(x.id))) return false;
```

3. `SavedFilter` gains `tags: string[];` (consumers added in Task 6 must read it as `f.tags ?? []` because filters saved before this feature lack the field).

- [ ] **Step 5: Extend `src/lib/demo-data.ts`**

1. In the `txn()` helper, add `tags: [],` to the returned object (before the closing brace, next to `splits: []`).
2. Above `DEMO_TRANSACTIONS`, define two chips:

```ts
const TAG_VACATION = { id: "tag-vacation", name: "vacation 2026", color: "#0891b2" };
const TAG_REIMBURSABLE = { id: "tag-reimbursable", name: "reimbursable", color: "#d97706" };
```

3. Attach `TAG_VACATION` to two EXPENSE rows and `TAG_REIMBURSABLE` to one EXPENSE row by wrapping the existing row literal: `{ ...txn(<args unchanged>), tags: [TAG_VACATION] }`. Which rows is cosmetic — pick travel-ish/restaurant rows.
4. After `DEMO_TRANSACTIONS`, add a stats-computed export (so counts always match the seeded rows):

```ts
export const DEMO_TAGS: TagDTO[] = [TAG_VACATION, TAG_REIMBURSABLE].map((chip) => {
  const tagged = DEMO_TRANSACTIONS.filter((t) => t.tags.some((x) => x.id === chip.id));
  return {
    ...chip,
    usageCount: tagged.length,
    totalAmount: tagged.reduce((sum, t) => sum + t.amount, 0),
  };
});
```

Import `TagDTO` from `@/lib/queries` (or `./queries/tags` matching the file's existing import style).

- [ ] **Step 6: Run tests to verify they pass**

Run: `npx vitest run "src/app/(app)/transactions/transactions-utils.test.ts" && npx tsc --noEmit`
Expected: PASS, tsc exits 0. If other tests construct `TransactionDTO` literals, add `tags: []` to those fixtures (`npm test` will point at them).

- [ ] **Step 7: Run the full suite**

Run: `npm test`
Expected: PASS. Fix any remaining `tags` missing-property fixture errors by adding `tags: []`.

- [ ] **Step 8: Commit**

```bash
git add src/lib/queries/transactions.ts "src/app/(app)/transactions/transactions-utils.ts" "src/app/(app)/transactions/transactions-utils.test.ts" src/lib/demo-data.ts
git commit -m "feat: tags on TransactionDTO with OR tag filtering" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Include any fixture files touched in step 7.)

---

### Task 6: Transactions page - tag filter UI + row chips

**Files:**
- Modify: `src/app/(app)/transactions/page.tsx`
- Modify: `src/app/(app)/transactions/TransactionsList.tsx`

**Interfaces:**
- Consumes: `getTags`/`TagDTO` (Task 3), `DEMO_TAGS` (Task 5), `filters.tagIds`/`SavedFilter.tags` (Task 5), existing `MultiSelect` (`MultiOption` supports `color` — no changes needed).
- Produces: `TransactionsList` props gain `tags: TagDTO[]` and `initialTagId?: string` (default `""`); URL param `tag` (comma-separated tag ids). Task 7 and 8 build on these props.

- [ ] **Step 1: Wire the server page**

In `src/app/(app)/transactions/page.tsx`:

1. `searchParams` type gains `tag?: string`.
2. Load tags next to accounts/categories: demo branch uses `DEMO_TAGS` (import from `@/lib/demo-data`), the real branch adds `getTags(userId)` to the existing `Promise.all`.
3. In the validation block, after the account filter validation:

```ts
  const tagIdSet = new Set(tags.map((t) => t.id));
  filters.tagIds = filters.tagIds.filter((v) => tagIdSet.has(v));
```

4. Pass to the list: `tags={tags}` and `initialTagId={filters.tagIds.join(",")}`.

- [ ] **Step 2: Extend `TransactionsList.tsx`**

All additions mirror the existing category-filter plumbing:

1. Props: add `tags: TagDTO[];` and `initialTagId?: string;` (destructure with default `""`). Import `TagDTO` via the existing `@/lib/queries` type import.
2. Filter set: `const tagFilter = useMemo(() => toSet(initialTagId), [initialTagId]);`
3. `currentParams()`: add `if (initialTagId) p.tag = initialTagId;`
4. Setter: `const setTagFilter = (s: Set<string>) => router.push(urlWith({ tag: [...s].join(",") }));`
5. After the Accounts `MultiSelect` block:

```tsx
        {tags.length > 0 && (
          <MultiSelect
            label="Tags"
            allLabel="All tags"
            options={tags.map((t) => ({ value: t.id, label: t.name, color: t.color }))}
            selected={tagFilter}
            onChange={setTagFilter}
          />
        )}
```

6. `applyFilter(f: SavedFilter)`: add `tag: (f.tags ?? []).join(",") || null` to the pushed params object (same null-when-empty style as the others).
7. `saveCurrentFilter`: add `tags: [...tagFilter],` to the built `SavedFilter`.
8. `hasActiveFilters`: OR in `tagFilter.size > 0`.
9. `clearAllFilters`: add `tag: null` to the pushed overrides.
10. Row chips — inside the description `<p className="truncate font-medium">`, after the existing note/pending/transfer badges:

```tsx
                    {t.tags.map((tag) => (
                      <span
                        key={tag.id}
                        className="ml-1 inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-px align-middle text-[10px] font-normal text-muted"
                      >
                        <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                        {tag.name}
                      </span>
                    ))}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit && npm test`
Expected: both pass. (If any test renders `TransactionsList`, give it `tags={[]}`.)

- [ ] **Step 4: Commit**

```bash
git add "src/app/(app)/transactions/page.tsx" "src/app/(app)/transactions/TransactionsList.tsx"
git commit -m "feat: tag filter dropdown and row chips on transactions page" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: TagInput component + edit-modal tagging

**Files:**
- Create: `src/components/TagInput.tsx`
- Modify: `src/components/TransactionModal.tsx`
- Modify: `src/actions/transactions.ts`
- Modify: `src/app/(app)/transactions/TransactionsList.tsx` (pass `tags` to the modal)
- Test: `src/actions/transactions.tags.test.ts` (new)

**Interfaces:**
- Consumes: `resolveTagIds` (Task 2), `TransactionDTO.tags` (Task 5), `TagDTO` (Task 3).
- Produces: `TagInput({ value: string[], onChange, options: TagOption[], placeholder? })` where `TagOption = { id: string; name: string; color: string }`; `txnSchema` gains `tags` (array of NAMES, resolved server-side, create-if-missing); `TransactionModal` props gain `tags?: TagOption[]` (all user tags, for autocomplete).

- [ ] **Step 1: Write the failing action tests**

Create `src/actions/transactions.tags.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { create: vi.fn(), update: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    transactionSplit: { deleteMany: vi.fn() },
    tag: { findMany: vi.fn(), create: vi.fn(), findFirst: vi.fn() },
    category: { findFirst: vi.fn() },
    financialAccount: { findFirst: vi.fn() },
    recurringRule: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { createTransactionAction, updateTransactionAction } from "./transactions";

const requireUserMock = vi.mocked(requireUser);

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  requireUserMock.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
  // interactive $transaction: run the callback against the same mock delegates
  vi.mocked(prisma.$transaction).mockImplementation(async (arg: unknown) =>
    typeof arg === "function" ? (arg as (tx: typeof prisma) => Promise<unknown>)(prisma) : Promise.all(arg as Promise<unknown>[]),
  );
});

const base = {
  type: "EXPENSE" as const,
  amount: 5,
  date: "2026-07-01",
  description: "Lunch",
};

describe("createTransactionAction tags", () => {
  it("resolves tag names and connects them on create", async () => {
    vi.mocked(prisma.tag.findMany).mockResolvedValue([] as never);
    vi.mocked(prisma.tag.create).mockResolvedValue({ id: "t9" } as never);
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "x1" } as never);

    const res = await createTransactionAction({ ...base, tags: ["Trip"] });
    expect(res.ok).toBe(true);
    const createArg = vi.mocked(prisma.transaction.create).mock.calls[0][0];
    expect(createArg.data.tags).toEqual({ connect: [{ id: "t9" }] });
  });

  it("omits the tags relation when no tags are given", async () => {
    vi.mocked(prisma.transaction.create).mockResolvedValue({ id: "x1" } as never);
    const res = await createTransactionAction({ ...base });
    expect(res.ok).toBe(true);
    const createArg = vi.mocked(prisma.transaction.create).mock.calls[0][0];
    expect(createArg.data.tags).toBeUndefined();
    expect(prisma.tag.findMany).not.toHaveBeenCalled();
  });
});

describe("updateTransactionAction tags", () => {
  it("replaces tags with set when tags are provided", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({ id: "x1", userId: "u1" } as never);
    vi.mocked(prisma.tag.findMany).mockResolvedValue([{ id: "t1", name: "Trip" }] as never);
    vi.mocked(prisma.transaction.update).mockResolvedValue({ id: "x1" } as never);

    const res = await updateTransactionAction("x1", { ...base, tags: ["Trip"] });
    expect(res.ok).toBe(true);
    const updateArg = vi.mocked(prisma.transaction.update).mock.calls[0][0];
    expect(updateArg.data.tags).toEqual({ set: [{ id: "t1" }] });
  });

  it("leaves tags untouched when tags is undefined", async () => {
    vi.mocked(prisma.transaction.findFirst).mockResolvedValue({ id: "x1", userId: "u1" } as never);
    vi.mocked(prisma.transaction.update).mockResolvedValue({ id: "x1" } as never);

    const res = await updateTransactionAction("x1", { ...base });
    expect(res.ok).toBe(true);
    const updateArg = vi.mocked(prisma.transaction.update).mock.calls[0][0];
    expect(updateArg.data.tags).toBeUndefined();
  });
});
```

If `createTransactionAction`/`updateTransactionAction` touch prisma delegates this mock lacks (check the failure output), add those as `vi.fn()` with sensible resolved values — copy the approach from `src/actions/transactions.crud.test.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/actions/transactions.tags.test.ts`
Expected: FAIL — `createArg.data.tags` is undefined in the first test (schema strips the unknown `tags` key).

- [ ] **Step 3: Extend `src/actions/transactions.ts`**

1. `txnSchema` gains (raw max 80 so `normalizeTagName` produces the user-facing 40-char error, not a raw Zod one):

```ts
  tags: z.array(z.string().max(80)).max(20).optional().nullable(),
```

2. Import `resolveTagIds` from `@/lib/tags`.
3. In `createTransactionAction`, after parsing/ownership checks and before the `prisma.$transaction`:

```ts
    const tagIds = data.tags?.length ? await resolveTagIds(userId, data.tags) : [];
```

and in the `tx.transaction.create` data object:

```ts
        ...(tagIds.length > 0 ? { tags: { connect: tagIds.map((id) => ({ id })) } } : {}),
```

4. In `updateTransactionAction`, before its `prisma.$transaction`:

```ts
    const tagIds = data.tags != null ? await resolveTagIds(userId, data.tags) : null;
```

and in the `tx.transaction.update` data object:

```ts
        ...(tagIds !== null ? { tags: { set: tagIds.map((id) => ({ id })) } } : {}),
```

`set` replaces the full list; `null`/`undefined` input leaves tags alone so callers that don't know about tags can't wipe them.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/actions/transactions.tags.test.ts && npx vitest run src/actions/transactions.crud.test.ts`
Expected: both PASS.

- [ ] **Step 5: Create `src/components/TagInput.tsx`**

```tsx
"use client";

import { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";

export interface TagOption {
  id: string;
  name: string;
  color: string;
}

interface TagInputProps {
  /** Current tag names, display-cased. */
  value: string[];
  onChange: (next: string[]) => void;
  /** All existing tags, for autocomplete and chip colors. */
  options: TagOption[];
  placeholder?: string;
}

export function TagInput({ value, onChange, options, placeholder = "Add tags…" }: TagInputProps) {
  const [text, setText] = useState("");
  const [focused, setFocused] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const chosen = useMemo(() => new Set(value.map((v) => v.toLowerCase())), [value]);
  const suggestions = useMemo(() => {
    const q = text.trim().toLowerCase();
    return options
      .filter((o) => !chosen.has(o.name.toLowerCase()))
      .filter((o) => !q || o.name.toLowerCase().includes(q))
      .slice(0, 8);
  }, [options, chosen, text]);

  const colorFor = (name: string) =>
    options.find((o) => o.name.toLowerCase() === name.toLowerCase())?.color ?? "#64748b";

  const add = (raw: string) => {
    const name = raw.trim().replace(/\s+/g, " ").slice(0, 40);
    setText("");
    if (!name || chosen.has(name.toLowerCase())) return;
    onChange([...value, name]);
  };

  const remove = (name: string) => onChange(value.filter((v) => v !== name));

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === ",") {
      e.preventDefault();
      add(text);
    } else if (e.key === "Backspace" && text === "" && value.length > 0) {
      remove(value[value.length - 1]);
    }
  };

  return (
    <div className="relative">
      <div
        className="input flex h-auto min-h-10 flex-wrap items-center gap-1.5 py-1.5"
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((name) => (
          <span
            key={name}
            className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-xs"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colorFor(name) }} />
            {name}
            <button type="button" onClick={() => remove(name)} aria-label={`Remove tag ${name}`}>
              <X size={12} />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="min-w-24 flex-1 bg-transparent text-sm outline-none"
          value={text}
          placeholder={value.length === 0 ? placeholder : ""}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onFocus={() => setFocused(true)}
          onBlur={() => setTimeout(() => setFocused(false), 150)}
        />
      </div>
      {focused && suggestions.length > 0 && (
        <div className="absolute z-20 mt-1 w-full rounded-lg border border-line bg-surface shadow-lg">
          {suggestions.map((o) => (
            <button
              key={o.id}
              type="button"
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-sm hover:bg-surface2"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => add(o.name)}
            >
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: o.color }} />
              {o.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 6: Wire `TransactionModal.tsx`**

1. Props gain `tags?: TagOption[];` (destructure with default `[]`); import `TagInput, { type TagOption }` — adjust to `import { TagInput, type TagOption } from "./TagInput";`.
2. The form state blob gains `tags: transaction?.tags.map((t) => t.name) ?? [] as string[],` (follow how the other fields are initialized from `transaction`).
3. `payload()` gains `tags: form.tags,`.
4. Between the note textarea and the cleared checkbox:

```tsx
        <div>
          <label className="label">Tags</label>
          <TagInput value={form.tags} onChange={(next) => set("tags", next)} options={tags} />
        </div>
```

If the `set(key, value)` helper's typing rejects the array, follow whatever the file does for `splits`.

- [ ] **Step 7: Pass tags through from the list**

In `TransactionsList.tsx`, add `tags={tags}` to every `<TransactionModal … />` call site. If `TransactionModal` is opened from other pages (check with `grep -rn "TransactionModal" src --include=*.tsx`), leave those call sites alone — the prop defaults to `[]` (no autocomplete, tagging still works).

- [ ] **Step 8: Verify and commit**

Run: `npx tsc --noEmit && npm test`
Expected: pass.

```bash
git add src/components/TagInput.tsx src/components/TransactionModal.tsx src/actions/transactions.ts src/actions/transactions.tags.test.ts "src/app/(app)/transactions/TransactionsList.tsx"
git commit -m "feat: TagInput chip component and tags in the transaction modal" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Bulk add/remove tag

**Files:**
- Modify: `src/actions/transactions.ts`
- Modify: `src/app/(app)/transactions/TransactionsList.tsx`
- Test: `src/actions/transactions.tags.test.ts` (append)

**Interfaces:**
- Consumes: `idsSchema` (already in `src/actions/transactions.ts`), `createTagAction` (Task 4, returns `{ ok: true; id }`), `tags` prop + `runBulk`/`start`/`selected` state (Task 6/existing).
- Produces: `bulkAddTagAction(ids: string[], tagId: string): Promise<ActionResult>`, `bulkRemoveTagAction(ids: string[], tagId: string): Promise<ActionResult>`.

- [ ] **Step 1: Write the failing tests**

Append to `src/actions/transactions.tags.test.ts`:

```ts
import { bulkAddTagAction, bulkRemoveTagAction } from "./transactions";

describe("bulkAddTagAction", () => {
  it("errors when the tag is not owned", async () => {
    vi.mocked(prisma.tag.findFirst).mockResolvedValue(null);
    const res = await bulkAddTagAction(["x1"], "t1");
    expect(res).toEqual({ ok: false, error: "Tag not found" });
  });

  it("connects the tag on owned rows that do not already have it", async () => {
    vi.mocked(prisma.tag.findFirst).mockResolvedValue({ id: "t1", userId: "u1" } as never);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([{ id: "x1" }, { id: "x2" }] as never);

    const res = await bulkAddTagAction(["x1", "x2", "not-mine"], "t1");
    expect(res).toEqual({ ok: true });
    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { in: ["x1", "x2", "not-mine"] }, NOT: { tags: { some: { id: "t1" } } } },
      select: { id: true },
    });
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "x1" },
      data: { tags: { connect: { id: "t1" } } },
    });
  });
});

describe("bulkRemoveTagAction", () => {
  it("disconnects the tag from owned rows that have it", async () => {
    vi.mocked(prisma.tag.findFirst).mockResolvedValue({ id: "t1", userId: "u1" } as never);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([{ id: "x1" }] as never);

    const res = await bulkRemoveTagAction(["x1"], "t1");
    expect(res).toEqual({ ok: true });
    expect(prisma.transaction.findMany).toHaveBeenCalledWith({
      where: { userId: "u1", id: { in: ["x1"] }, tags: { some: { id: "t1" } } },
      select: { id: true },
    });
    expect(prisma.transaction.update).toHaveBeenCalledWith({
      where: { id: "x1" },
      data: { tags: { disconnect: { id: "t1" } } },
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/actions/transactions.tags.test.ts`
Expected: FAIL — `bulkAddTagAction` is not exported.

- [ ] **Step 3: Implement the actions**

Add to `src/actions/transactions.ts`, next to `bulkSetCategoryAction`:

```ts
export async function bulkAddTagAction(ids: string[], tagId: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const list = idsSchema.parse(ids);
    const tag = await prisma.tag.findFirst({ where: { id: tagId, userId } });
    if (!tag) throw new UserError("Tag not found");
    // updateMany cannot touch m2m relations, and connect on an existing pair
    // violates the join table's unique constraint - per-row updates, new rows only.
    const rows = await prisma.transaction.findMany({
      where: { userId, id: { in: list }, NOT: { tags: { some: { id: tagId } } } },
      select: { id: true },
    });
    await prisma.$transaction(
      rows.map((t) =>
        prisma.transaction.update({ where: { id: t.id }, data: { tags: { connect: { id: tagId } } } }),
      ),
    );
    revalidateAll();
  });
}

export async function bulkRemoveTagAction(ids: string[], tagId: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const list = idsSchema.parse(ids);
    const tag = await prisma.tag.findFirst({ where: { id: tagId, userId } });
    if (!tag) throw new UserError("Tag not found");
    const rows = await prisma.transaction.findMany({
      where: { userId, id: { in: list }, tags: { some: { id: tagId } } },
      select: { id: true },
    });
    await prisma.$transaction(
      rows.map((t) =>
        prisma.transaction.update({ where: { id: t.id }, data: { tags: { disconnect: { id: tagId } } } }),
      ),
    );
    revalidateAll();
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/actions/transactions.tags.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the bulk-bar controls**

In `TransactionsList.tsx`, next to the existing "Set category…" select in the bulk bar (same classes as that select), import `bulkAddTagAction`, `bulkRemoveTagAction` from `@/actions/transactions` and `createTagAction` from `@/actions/tags`, then add:

```tsx
              <select
                className="input h-8 w-auto text-xs"
                defaultValue=""
                onChange={(e) => {
                  const v = e.currentTarget.value;
                  e.currentTarget.value = "";
                  if (!v) return;
                  if (v === "__create__") {
                    const name = window.prompt("New tag name");
                    if (!name?.trim()) return;
                    start(async () => {
                      setBulkError(null);
                      const created = await createTagAction({ name });
                      if (!created.ok) return setBulkError(created.error);
                      const res = await bulkAddTagAction([...selected], created.id);
                      if (res.ok) clearSelection();
                      else setBulkError(res.error ?? "Something went wrong.");
                    });
                    return;
                  }
                  runBulk((ids) => bulkAddTagAction(ids, v));
                }}
              >
                <option value="" disabled>
                  Add tag…
                </option>
                <option value="__create__">＋ New tag…</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              {tags.length > 0 && (
                <select
                  className="input h-8 w-auto text-xs"
                  defaultValue=""
                  onChange={(e) => {
                    const v = e.currentTarget.value;
                    e.currentTarget.value = "";
                    if (v) runBulk((ids) => bulkRemoveTagAction(ids, v));
                  }}
                >
                  <option value="" disabled>
                    Remove tag…
                  </option>
                  {tags.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              )}
```

Reuse the file's actual `start`/`runBulk`/`clearSelection`/`setBulkError` identifiers (they exist — match their exact names).

- [ ] **Step 6: Verify and commit**

Run: `npx tsc --noEmit && npm test`
Expected: pass.

```bash
git add src/actions/transactions.ts src/actions/transactions.tags.test.ts "src/app/(app)/transactions/TransactionsList.tsx"
git commit -m "feat: bulk add/remove tag from the transactions bulk bar" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: `addTag` rule action in the rules engine

**Files:**
- Modify: `src/lib/rules.ts`
- Test: `src/lib/rules.test.ts` (append)

**Interfaces:**
- Consumes: existing `RuleAction`, `RuleEffect`, `evaluateRules`.
- Produces: `RuleAction` union gains `| { type: "addTag"; tagId: string }`; `RuleEffect` gains `addTagIds?: string[]`. Additive: accumulates across ALL matching rules, dedups, exempt from first-wins. (If Task 4 already added the two type lines, this task adds only the evaluate case and tests.)

- [ ] **Step 1: Write the failing tests**

Append to `src/lib/rules.test.ts` (reuses the file's `facts`/`rule` helpers):

```ts
describe("addTag actions", () => {
  it("accumulates tags across matching rules and dedups", () => {
    const rules: RuleLike[] = [
      rule({ id: "r1", priority: 0, actions: [{ type: "addTag", tagId: "a" }] }),
      rule({
        id: "r2",
        priority: 1,
        actions: [
          { type: "addTag", tagId: "b" },
          { type: "addTag", tagId: "a" },
        ],
      }),
    ];
    expect(evaluateRules(facts(), rules).addTagIds).toEqual(["a", "b"]);
  });

  it("is exempt from first-wins: later rules still add tags", () => {
    const rules: RuleLike[] = [
      rule({
        id: "r1",
        priority: 0,
        actions: [
          { type: "setCategory", categoryId: "c1" },
          { type: "addTag", tagId: "a" },
        ],
      }),
      rule({
        id: "r2",
        priority: 1,
        actions: [
          { type: "setCategory", categoryId: "c2" },
          { type: "addTag", tagId: "b" },
        ],
      }),
    ];
    const effect = evaluateRules(facts(), rules);
    expect(effect.categoryId).toBe("c1");
    expect(effect.addTagIds).toEqual(["a", "b"]);
  });

  it("keeps tags when a split clears the category", () => {
    const rules: RuleLike[] = [
      rule({
        id: "r1",
        priority: 0,
        actions: [
          {
            type: "split",
            parts: [
              { categoryId: "c1", percent: 50 },
              { categoryId: "c2", percent: 50 },
            ],
          },
          { type: "addTag", tagId: "a" },
        ],
      }),
    ];
    const effect = evaluateRules(facts(), rules);
    expect(effect.addTagIds).toEqual(["a"]);
    expect(effect.categoryId).toBeUndefined();
  });

  it("leaves addTagIds undefined when no rule adds a tag", () => {
    expect(evaluateRules(facts(), [rule({})]).addTagIds).toBeUndefined();
  });
});
```

If the file's split fixtures use a different `SplitPart` shape than `{ categoryId, percent }`, copy the shape from the existing split tests in this file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/lib/rules.test.ts`
Expected: the new tests FAIL (`addTagIds` undefined / type error on `addTag`).

- [ ] **Step 3: Implement**

In `src/lib/rules.ts`:

1. `RuleAction` union gains:

```ts
  | { type: "addTag"; tagId: string }
```

2. `RuleEffect` gains:

```ts
  addTagIds?: string[];
```

3. In `evaluateRules`'s per-action switch, add (no first-wins guard — additive by design):

```ts
      case "addTag":
        if (!effect.addTagIds) effect.addTagIds = [];
        if (!effect.addTagIds.includes(action.tagId)) effect.addTagIds.push(action.tagId);
        break;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/rules.test.ts`
Expected: PASS (all, including pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rules.ts src/lib/rules.test.ts
git commit -m "feat: additive addTag action in the rules engine" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: addTag in rule actions - schema, preview, apply

**Files:**
- Modify: `src/actions/rules.ts`
- Test: `src/actions/rules.test.ts` (run; adjust fixtures if the new fields break assertions)

**Interfaces:**
- Consumes: `RuleEffect.addTagIds` (Task 9).
- Produces: `actionSchema` accepts `{ type: "addTag", tagId }`; `assertReferencesOwned` validates tag ownership (`UserError("Tag not found")`); `RulePreview` gains `wouldTag: number`; `ApplyResult` gains `tagged: number`. Task 11's UI reads `wouldTag`/`tagged`.

- [ ] **Step 1: Extend the schema and ownership check**

In `src/actions/rules.ts`:

1. Add to the `actionSchema` discriminated union:

```ts
  z.object({ type: z.literal("addTag"), tagId: z.string().min(1) }),
```

2. In `assertReferencesOwned`, collect tag ids next to the existing category/account collection:

```ts
  const tagIds = new Set<string>();
  for (const a of actions) {
    if (a.type === "addTag") tagIds.add(a.tagId);
  }
```

(fold into the existing action loop if there is one), and after the existing count checks:

```ts
  if (tagIds.size > 0) {
    const n = await prisma.tag.count({ where: { userId, id: { in: [...tagIds] } } });
    if (n !== tagIds.size) throw new UserError("Tag not found");
  }
```

- [ ] **Step 2: Extend preview**

1. `RulePreview` gains `wouldTag: number;` and the demo-mode early return gains `wouldTag: 0`.
2. Initialize `let wouldTag = 0;` next to the other counters and include `wouldTag` in the returned object.
3. The transaction `select` gains `tags: { select: { id: true } }` (keep the existing selected fields).
4. Load live tag ids once, next to where rules are loaded:

```ts
    const liveTagIds = new Set(
      (await prisma.tag.findMany({ where: { userId }, select: { id: true } })).map((t) => t.id),
    );
```

5. In the per-transaction loop, after the effect is computed, next to the other counters (only tags the row doesn't already carry count, and deleted-tag references are skipped):

```ts
      const newTagIds = (effect.addTagIds ?? []).filter(
        (id) => liveTagIds.has(id) && !t.tags.some((x) => x.id === id),
      );
      if (newTagIds.length > 0) {
        wouldTag++;
        labels.push("tag");
      }
```

(`labels` is whatever array feeds the sample `effect` description — match the existing name.)

- [ ] **Step 3: Extend apply**

1. `ApplyResult` gains `tagged: number;`, the demo-mode early return gains `tagged: 0`, initialize `let tagged = 0;`, return it.
2. The transaction `select` gains `tags: { select: { id: true } }`.
3. Load `liveTagIds` exactly as in preview.
4. In the loop, compute `newTagIds` exactly as in preview, then:
   - **Splits path** (the branch ending `split++; continue;`): before `continue`, add:

```ts
        if (newTagIds.length > 0) {
          await prisma.transaction.update({
            where: { id: t.id },
            data: { tags: { connect: newTagIds.map((id) => ({ id })) } },
          });
          tagged++;
        }
```

   - **Ordinary path**: extend the `data` object with

```ts
      if (newTagIds.length > 0) data.tags = { connect: newTagIds.map((id) => ({ id })) };
```

     placed before the existing `if (Object.keys(data).length > 0)` update guard (the tags key makes the update fire even when nothing else changed), and increment `tagged++` when `newTagIds.length > 0` after the update runs. If `data` is currently typed too narrowly for a `tags` key, widen its type to `Prisma.TransactionUpdateInput`.

- [ ] **Step 4: Verify**

Run: `npx vitest run src/actions/rules.test.ts && npx tsc --noEmit`
Expected: PASS / exit 0. If existing tests assert the exact `RulePreview`/`ApplyResult` shapes, extend the expected objects with `wouldTag: 0` / `tagged: 0`; if the tests' prisma mock lacks `tag.findMany`, add `tag: { findMany: vi.fn().mockResolvedValue([]), count: vi.fn().mockResolvedValue(0) }`.

- [ ] **Step 5: Commit**

```bash
git add src/actions/rules.ts src/actions/rules.test.ts
git commit -m "feat: addTag rule action in preview, apply, and ownership checks" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 11: Rules editor UI for addTag

**Files:**
- Modify: `src/app/(app)/categories/RulesCard.tsx`
- Modify: `src/app/(app)/categories/page.tsx`

**Interfaces:**
- Consumes: `TagDTO`/`getTags` (Task 3), `DEMO_TAGS` (Task 5), `wouldTag`/`tagged` (Task 10).
- Produces: `RulesCard` props gain `tags: TagDTO[]`; the categories page loads tags (Task 13 reuses this load for the Tags tab).

- [ ] **Step 1: Load tags on the categories page**

In `src/app/(app)/categories/page.tsx`: demo branch gets `const tags = DEMO_TAGS;` (import from `@/lib/demo-data`); the real branch adds `getTags(userId)` to the existing `Promise.all`. Pass `tags={tags}` to `<RulesCard … />`.

- [ ] **Step 2: Extend `RulesCard.tsx`**

1. Props: `tags: TagDTO[]` on `RulesCardProps`; thread it down to `RuleEditor` (both call sites) and from there to the action-row component.
2. `ACTION_TYPES` gains `"addTag"`; `TYPE_LABELS` gains `addTag: "Add tag",`.
3. `blankAction` switch gains:

```ts
    case "addTag":
      return { type, tagId: "" };
```

4. `actionLabel` gains a `tags: TagDTO[]` parameter (update every caller) and:

```ts
    case "addTag":
      return `add tag ${tags.find((t) => t.id === a.tagId)?.name ?? "(deleted)"}`;
```

5. In the action-row editor, mirror the `setCategory` select (same classes and update callback the row uses for its other selects):

```tsx
        {action.type === "addTag" && (
          <select
            className="input"
            value={action.tagId}
            onChange={(e) => update({ ...action, tagId: e.target.value })}
          >
            <option value="">Select tag…</option>
            {tags.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        )}
```

(`update` = the row's existing change callback; match its real name.)
6. Preview toast parts gain `if (res.wouldTag) parts.push(\`tag ${res.wouldTag}\`);` next to the other `parts.push` lines; apply-now parts gain `if (res.tagged) parts.push(\`tagged ${res.tagged}\`);`.

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm test`
Expected: pass.

```bash
git add "src/app/(app)/categories/RulesCard.tsx" "src/app/(app)/categories/page.tsx"
git commit -m "feat: addTag action type in the rules editor" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 12: Auto-tagging in Plaid sync and CSV import

**Files:**
- Modify: `src/lib/plaid-sync.ts`
- Modify: `src/actions/import.ts`
- Modify: `src/components/ImportReview.tsx`
- Test: run `src/lib/plaid-sync.sync.test.ts`, `src/lib/plaid-sync.test.ts`, `src/actions/import.test.ts` (extend mocks if needed)

**Interfaces:**
- Consumes: `RuleEffect.addTagIds` (Task 9).
- Produces: `AnalyzedRow` gains `suggestedTagIds: string[]`; `commitRowSchema` gains `tagIds?: string[]`; synced/imported transactions carry rule-applied tags.

- [ ] **Step 1: Plaid sync**

In `src/lib/plaid-sync.ts`:

1. Next to the `automationRules` load (`const ruleRows = await prisma.rule.findMany(...)` around line 199), add:

```ts
  const liveTagIds = new Set(
    (await prisma.tag.findMany({ where: { userId: item.userId }, select: { id: true } })).map((t) => t.id),
  );
```

2. In the ADDED loop, immediately after the `const row = await prisma.transaction.upsert({ … })` call:

```ts
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
```

(Deliberately unconditional on `recategorizeOnly` so a re-sync backfills tags too. The read-before-connect avoids duplicate join rows on the upsert's update path.)

3. In the MODIFIED loop, after the `prisma.transaction.updateMany({ … })` call (updateMany cannot touch m2m, so look the row up):

```ts
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
```

4. Run: `npx vitest run src/lib/plaid-sync.sync.test.ts src/lib/plaid-sync.test.ts`
Expected: PASS. If the prisma mock lacks `tag.findMany` or `transaction.findUnique`, add them (`tag: { findMany: vi.fn().mockResolvedValue([]) }`, `findUnique: vi.fn().mockResolvedValue({ tags: [] })`).

- [ ] **Step 2: CSV import actions**

In `src/actions/import.ts`:

1. `AnalyzedRow` gains:

```ts
  /** Tag ids suggested by addTag rules. */
  suggestedTagIds: string[];
```

2. In `analyzeImportAction`'s row mapping, add to the returned object:

```ts
      const suggestedTagIds = effect.addTagIds ?? [];
```

and include `suggestedTagIds` in the return literal.

3. `commitRowSchema` gains:

```ts
  tagIds: z.array(z.string()).max(20).optional(),
```

4. In `commitImportAction`, after the `validCatIds` block, replace the single `createManyAndReturn` with (createManyAndReturn cannot set m2m relations, so tag-bearing rows are created individually):

```ts
    const providedTags = [...new Set(rows.flatMap((r) => r.tagIds ?? []))];
    const validTagIds = new Set(
      providedTags.length
        ? (await prisma.tag.findMany({ where: { userId, id: { in: providedTags } }, select: { id: true } })).map((t) => t.id)
        : [],
    );

    const rowData = (r: (typeof rows)[number]) => ({
      userId,
      accountId: accountId || null,
      categoryId: r.categoryId && validCatIds.has(r.categoryId) ? r.categoryId : null,
      type: r.type as TxnType,
      amount: r.amount,
      date: parseISODay(r.date),
      description: r.description,
      cleared: true,
    });

    const withTags = rows.filter((r) => (r.tagIds ?? []).some((id) => validTagIds.has(id)));
    const plain = rows.filter((r) => !withTags.includes(r));

    const created = plain.length
      ? await prisma.transaction.createManyAndReturn({
          data: plain.map(rowData),
          select: { id: true },
        })
      : [];
    for (const r of withTags) {
      const ids = [...new Set((r.tagIds ?? []).filter((id) => validTagIds.has(id)))];
      const t = await prisma.transaction.create({
        data: { ...rowData(r), tags: { connect: ids.map((id) => ({ id })) } },
        select: { id: true },
      });
      created.push(t);
    }
```

(`created` keeps its role in the notification event below — no change there.) Note `created` must be mutable: if it was `const created = await …`, the shape above already handles it via the ternary + push.

5. Run: `npx vitest run src/actions/import.test.ts`
Expected: PASS. If assertions inspect `AnalyzedRow`, extend expected objects with `suggestedTagIds: []`; extend the prisma mock with `tag: { findMany: vi.fn().mockResolvedValue([]) }` and `transaction.create` if missing.

- [ ] **Step 3: Thread tag ids through `ImportReview.tsx`**

1. `EditableRow` gains `tagIds: string[];`
2. `toEditable` gains `tagIds: r.suggestedTagIds,`
3. The `payload` mapping in `submit` gains `tagIds: r.tagIds,`

(No visible UI - suggested tags ride along invisibly; the review table stays as is.)

- [ ] **Step 4: Verify and commit**

Run: `npx tsc --noEmit && npm test`
Expected: pass.

```bash
git add src/lib/plaid-sync.ts src/actions/import.ts src/components/ImportReview.tsx
git commit -m "feat: apply addTag rules during plaid sync and csv import" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Include any test files whose mocks were extended.)

---

### Task 13: Tags tab + TagsManager on /categories

**Files:**
- Create: `src/app/(app)/categories/TagsManager.tsx`
- Modify: `src/app/(app)/categories/page.tsx`

**Interfaces:**
- Consumes: `TagDTO` (Task 3), tag actions (Task 4), `COLOR_PALETTE` from `@/lib/colors`, `formatUSD` from `@/lib/money`, `Modal` from `@/components/Modal` (props: `open`, `onClose`, `title`, optional `widthClass`).
- Produces: `TagsManager({ tags: TagDTO[] })`; `?tab=tags` URL switch on /categories.

- [ ] **Step 1: Create `TagsManager.tsx`**

```tsx
"use client";

import { useState, useTransition } from "react";
import { Plus } from "lucide-react";
import { Modal } from "@/components/Modal";
import { COLOR_PALETTE } from "@/lib/colors";
import { formatUSD } from "@/lib/money";
import type { TagDTO } from "@/lib/queries";
import {
  createTagAction,
  renameTagAction,
  setTagColorAction,
  deleteTagAction,
  mergeTagsAction,
} from "@/actions/tags";

const DEFAULT_COLOR = "#64748b";

export function TagsManager({ tags }: { tags: TagDTO[] }) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<TagDTO | null>(null);
  const [merging, setMerging] = useState<TagDTO | null>(null);
  const [armedDelete, setArmedDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const remove = (id: string) => {
    if (armedDelete !== id) {
      setArmedDelete(id);
      return;
    }
    start(async () => {
      setError(null);
      const res = await deleteTagAction(id);
      if (!res.ok) setError(res.error);
      setArmedDelete(null);
    });
  };

  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-sm font-semibold">Tags</h2>
        <button className="btn-primary inline-flex items-center gap-1 text-xs" onClick={() => setAdding(true)}>
          <Plus size={14} /> New tag
        </button>
      </div>

      {error && <p className="mb-2 text-sm text-expense">{error}</p>}

      {tags.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted">
          No tags yet. Create one here or type a new tag on any transaction.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {tags.map((t) => (
            <li key={t.id} className="flex items-center gap-3 py-2.5">
              <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: t.color }} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{t.name}</p>
                <p className="text-xs text-muted">
                  {t.usageCount} transaction{t.usageCount === 1 ? "" : "s"} · {formatUSD(t.totalAmount)}
                </p>
              </div>
              <button className="btn-ghost text-xs" onClick={() => setEditing(t)}>
                Edit
              </button>
              {tags.length > 1 && (
                <button className="btn-ghost text-xs" onClick={() => setMerging(t)}>
                  Merge
                </button>
              )}
              <button className="btn-ghost text-xs text-expense" disabled={pending} onClick={() => remove(t.id)}>
                {armedDelete === t.id ? "Click to confirm" : "Delete"}
              </button>
            </li>
          ))}
        </ul>
      )}

      {(adding || editing) && (
        <TagFormModal
          key={editing?.id ?? "new"}
          tag={editing}
          tags={tags}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
      {merging && <MergeModal source={merging} tags={tags} onClose={() => setMerging(null)} />}
    </div>
  );
}

function TagFormModal({ tag, tags, onClose }: { tag: TagDTO | null; tags: TagDTO[]; onClose: () => void }) {
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState(tag?.color ?? DEFAULT_COLOR);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const normalized = name.trim().replace(/\s+/g, " ");
  const collision = tags.find(
    (t) => t.id !== tag?.id && t.name.toLowerCase() === normalized.toLowerCase(),
  );

  const submit = () =>
    start(async () => {
      setError(null);
      if (!tag) {
        const res = await createTagAction({ name, color });
        if (!res.ok) return setError(res.error);
      } else {
        if (normalized !== tag.name) {
          const res = await renameTagAction(tag.id, name);
          if (!res.ok) return setError(res.error);
        }
        if (color !== tag.color) {
          const res = await setTagColorAction(tag.id, color);
          if (!res.ok) return setError(res.error);
        }
      }
      onClose();
    });

  const merge = () =>
    start(async () => {
      if (!tag || !collision) return;
      setError(null);
      const res = await mergeTagsAction(tag.id, collision.id);
      if (!res.ok) return setError(res.error);
      onClose();
    });

  return (
    <Modal open onClose={onClose} title={tag ? "Edit tag" : "New tag"}>
      <div className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div>
          <label className="label">Color</label>
          <div className="flex flex-wrap gap-2">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={`Use color ${c}`}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-surface ${color === c ? "ring-brand" : "ring-transparent"}`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {collision && (
          <div className="rounded-lg border border-line bg-surface2 p-3 text-sm">
            <p>A tag named “{collision.name}” already exists.</p>
            {tag && (
              <button type="button" className="btn-primary mt-2 text-xs" disabled={pending} onClick={merge}>
                Merge “{tag.name}” into “{collision.name}”
              </button>
            )}
          </div>
        )}

        {error && <p className="text-sm text-expense">{error}</p>}

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={pending || !normalized || !!collision} onClick={submit}>
            {tag ? "Save" : "Create"}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function MergeModal({ source, tags, onClose }: { source: TagDTO; tags: TagDTO[]; onClose: () => void }) {
  const [targetId, setTargetId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const others = tags.filter((t) => t.id !== source.id);

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await mergeTagsAction(source.id, targetId);
      if (!res.ok) return setError(res.error);
      onClose();
    });

  return (
    <Modal open onClose={onClose} title={`Merge “${source.name}”`}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Every transaction tagged “{source.name}” gets the target tag instead, rules are updated, and “{source.name}”
          is deleted.
        </p>
        <div>
          <label className="label">Merge into</label>
          <select className="input" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
            <option value="">Select tag…</option>
            {others.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </div>
        {error && <p className="text-sm text-expense">{error}</p>}
        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn-primary" disabled={pending || !targetId} onClick={submit}>
            Merge
          </button>
        </div>
      </div>
    </Modal>
  );
}
```

If the CSS utility classes above (`btn-primary`, `btn-ghost`, `input`, `label`, `text-expense`, `border-line`, `bg-surface`, `bg-surface2`, `text-muted`, `ring-brand`) differ from what `CategoriesManager.tsx` actually uses, match `CategoriesManager.tsx` — it is the styling template for this component.

- [ ] **Step 2: Add the tab switch to the page**

In `src/app/(app)/categories/page.tsx`:

1. Accept search params: component signature becomes

```tsx
export default async function CategoriesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = await searchParams;
  const showTags = tab === "tags";
```

2. Keep the existing data loading (tags already load from Task 11; in demo mode `tags = DEMO_TAGS`).
3. Below the existing `PageHeader`, add the tab switch (import `Link` from `next/link`):

```tsx
      <div className="flex w-fit gap-1 rounded-lg border border-line bg-surface2 p-1 text-sm">
        <Link
          href="/categories"
          className={`rounded-md px-3 py-1 ${!showTags ? "bg-surface font-medium" : "text-muted"}`}
        >
          Categories
        </Link>
        <Link
          href="/categories?tab=tags"
          className={`rounded-md px-3 py-1 ${showTags ? "bg-surface font-medium" : "text-muted"}`}
        >
          Tags
        </Link>
      </div>
```

4. Wrap the body:

```tsx
      {showTags ? (
        <TagsManager tags={tags} />
      ) : (
        <>
          <CategoriesManager categories={categories} />
          {!DEMO_MODE && <RulesCard rules={rules} categories={categories} accounts={accounts} tags={tags} />}
        </>
      )}
```

(No nav changes — /categories already exists in `app-nav`.)

- [ ] **Step 3: Verify and commit**

Run: `npx tsc --noEmit && npm test`
Expected: pass. Manual spot-check if a dev server is handy: `/categories?tab=tags` renders the list; create/rename/recolor/merge/delete round-trip.

```bash
git add "src/app/(app)/categories/TagsManager.tsx" "src/app/(app)/categories/page.tsx"
git commit -m "feat: tags management tab on the categories page" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 14: Edges - CSV export column + backup join-table filter

**Files:**
- Modify: `src/app/(app)/transactions/export/route.ts`
- Modify: `src/lib/backup/index.ts`

**Interfaces:**
- Consumes: `TransactionDTO.tags` (Task 5).
- Produces: CSV "Tags" column (names joined `"; "`); per-user backup export includes `_TagToTransaction` rows (`Tag` itself is auto-included via its `userId` column; `exportAllData` is schema-agnostic and needs nothing).

- [ ] **Step 1: CSV export**

In `src/app/(app)/transactions/export/route.ts`:

1. Append `"Tags"` to the `header` array (after `"Note"`).
2. In the row mapping, append after the note field:

```ts
      csvField(t.tags.map((x) => x.name).join("; ")),
```

- [ ] **Step 2: Backup child filter**

In `src/lib/backup/index.ts`, add to `CHILD_FILTERS` (line ~65):

```ts
  _TagToTransaction: '"A" IN (SELECT id FROM "Tag" WHERE "userId" = $1)',
```

(`"A"` is the Tag id column in Prisma's implicit join table — model names sort alphabetically, Tag before Transaction.)

- [ ] **Step 3: Verify and commit**

Run: `npx vitest run src/actions/backup.test.ts && npx tsc --noEmit`
Expected: pass (extend backup test fixtures if any assert the exact `CHILD_FILTERS` keys).

```bash
git add "src/app/(app)/transactions/export/route.ts" src/lib/backup/index.ts
git commit -m "feat: tags in csv export and per-user backup" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 15: Final verification

**Files:** none new — fixes only if something fails.

- [ ] **Step 1: Full test suite**

Run: `npm test`
Expected: all tests pass.

- [ ] **Step 2: Lint + typecheck**

Run: `npm run lint && npx tsc --noEmit`
Expected: clean.

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: compiles (this repo builds without a full `.env` — imports must not throw at module load; nothing in this plan adds import-time env access).

- [ ] **Step 4: Commit any fixes**

```bash
git add -A
git commit -m "fix: post-tags cleanup from full-suite verification" -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

(Skip the commit if nothing changed.)
