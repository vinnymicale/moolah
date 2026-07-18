# Receipt & Document Attachments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Attach receipt photos/PDFs to transactions, stored as bytea in Postgres, with upload/view/delete in the transaction modal and a paperclip indicator in the list.

**Architecture:** New `Attachment` Prisma model holding file bytes. Route handlers (`/api/attachments`) for upload/download/delete because downloads need GET and server actions cap bodies at 1MB. `TransactionDTO` gains attachment metadata (never bytes). Client-side canvas downscaling shrinks phone photos before upload. Backup export/import gains explicit bytea (Buffer <-> base64) handling so attachments survive the JSON round-trip.

**Tech Stack:** Next.js 16 app router, Prisma/Postgres, Vitest, Tailwind, lucide-react icons.

Spec: `docs/superpowers/specs/2026-07-18-receipt-attachments-design.md`

## Global Constraints

- Accepted MIME types: `image/jpeg`, `image/png`, `image/webp`, `image/heic`, `image/heif`, `application/pdf`.
- Max 10MB per file (server-enforced), max 5 attachments per transaction (server-enforced).
- Demo mode (`isDemoMode()`) must never write to the DB; mutations return ok-shaped responses.
- All attachment reads/writes are scoped by `userId` from `requireUser()`.
- Dynamic route params are Promises in this Next version: `{ params: Promise<{ id: string }> }` then `await params` (see `src/app/api/plaid/item/[itemId]/route.ts`).
- No em-dashes in comments or copy; match existing comment density (sparse, only for non-obvious constraints).
- Run tests with `npx vitest run <path>`. Typecheck with `npx tsc --noEmit`.

---

### Task 1: Attachment model + migration

**Files:**
- Modify: `prisma/schema.prisma` (Transaction model ends ~line 305; User model starts line 17)

**Interfaces:**
- Produces: Prisma model `Attachment { id, userId, transactionId, filename, mimeType, size, data, createdAt }`, `Transaction.attachments`, `User.attachments`. Later tasks use `prisma.attachment.*` and `_count.attachments`.

- [ ] **Step 1: Add the model to `prisma/schema.prisma`**

After the `TransactionSplit` model (ends line 321), add:

```prisma
// A receipt or document file attached to a transaction. Bytes live in the DB
// so the feature works on both Vercel and self-host, and rides along with the
// whole-schema backup dump.
model Attachment {
  id            String      @id @default(cuid())
  userId        String
  user          User        @relation(fields: [userId], references: [id], onDelete: Cascade)

  transactionId String
  transaction   Transaction @relation(fields: [transactionId], references: [id], onDelete: Cascade)

  filename      String
  mimeType      String
  size          Int
  data          Bytes

  createdAt     DateTime    @default(now())

  @@index([transactionId])
  @@index([userId])
}
```

In `model Transaction`, after `tags Tag[]` (line 284), add:

```prisma
  attachments     Attachment[]
```

In `model User`, alongside the other relation lists (look for lines like `tags Tag[]` / `transactions Transaction[]`), add:

```prisma
  attachments      Attachment[]
```

- [ ] **Step 2: Create the migration and regenerate the client**

Run: `npx prisma migrate dev --name add_attachments`
Expected: new folder `prisma/migrations/<timestamp>_add_attachments/` containing `CREATE TABLE "Attachment"`, and "Generated Prisma Client" output. If the dev DB isn't running, start it the way the repo's docker-compose does (`docker compose up -d db` or check `docker-compose.yml` for the service name).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (nothing consumes the model yet).

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat: add Attachment model for transaction receipts"
```

---

### Task 2: Upload validation helpers

**Files:**
- Create: `src/lib/attachments.ts`
- Test: `src/lib/attachments.test.ts`

**Interfaces:**
- Produces:
  - `MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024`
  - `MAX_ATTACHMENTS_PER_TRANSACTION = 5`
  - `ALLOWED_ATTACHMENT_TYPES: ReadonlySet<string>`
  - `interface AttachmentDTO { id: string; filename: string; mimeType: string; size: number }`
  - `validateAttachmentUpload(input: { mimeType: string; size: number; existingCount: number }): string | null` (null = valid, string = user-facing error)

- [ ] **Step 1: Write the failing test**

Create `src/lib/attachments.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  validateAttachmentUpload,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENTS_PER_TRANSACTION,
} from "./attachments";

const ok = { mimeType: "image/jpeg", size: 1024, existingCount: 0 };

describe("validateAttachmentUpload", () => {
  it("accepts a small jpeg", () => {
    expect(validateAttachmentUpload(ok)).toBeNull();
  });

  it("accepts every allowed type", () => {
    for (const t of ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif", "application/pdf"]) {
      expect(validateAttachmentUpload({ ...ok, mimeType: t })).toBeNull();
    }
  });

  it("rejects disallowed types", () => {
    expect(validateAttachmentUpload({ ...ok, mimeType: "image/svg+xml" })).toMatch(/type/i);
    expect(validateAttachmentUpload({ ...ok, mimeType: "text/html" })).toMatch(/type/i);
    expect(validateAttachmentUpload({ ...ok, mimeType: "" })).toMatch(/type/i);
  });

  it("rejects files over the size cap", () => {
    expect(validateAttachmentUpload({ ...ok, size: MAX_ATTACHMENT_BYTES + 1 })).toMatch(/10MB/);
    expect(validateAttachmentUpload({ ...ok, size: MAX_ATTACHMENT_BYTES })).toBeNull();
  });

  it("rejects empty files", () => {
    expect(validateAttachmentUpload({ ...ok, size: 0 })).toMatch(/empty/i);
  });

  it("rejects when the transaction is at the attachment cap", () => {
    expect(
      validateAttachmentUpload({ ...ok, existingCount: MAX_ATTACHMENTS_PER_TRANSACTION }),
    ).toMatch(/5/);
    expect(
      validateAttachmentUpload({ ...ok, existingCount: MAX_ATTACHMENTS_PER_TRANSACTION - 1 }),
    ).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/attachments.test.ts`
Expected: FAIL, cannot resolve `./attachments`.

- [ ] **Step 3: Write the implementation**

Create `src/lib/attachments.ts`:

```ts
// Shared limits + validation for transaction attachments. Used by the
// /api/attachments route handlers (authoritative) and the client UI (early
// feedback before uploading).

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TRANSACTION = 5;

export const ALLOWED_ATTACHMENT_TYPES: ReadonlySet<string> = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
  "application/pdf",
]);

/** Attachment metadata sent to the client. Never includes the bytes. */
export interface AttachmentDTO {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

/**
 * Returns a user-facing error string, or null when the upload is acceptable.
 */
export function validateAttachmentUpload(input: {
  mimeType: string;
  size: number;
  existingCount: number;
}): string | null {
  if (!ALLOWED_ATTACHMENT_TYPES.has(input.mimeType)) {
    return "Unsupported file type. Use a JPEG, PNG, WebP, HEIC, or PDF.";
  }
  if (input.size <= 0) return "That file is empty.";
  if (input.size > MAX_ATTACHMENT_BYTES) return "File is too large (max 10MB).";
  if (input.existingCount >= MAX_ATTACHMENTS_PER_TRANSACTION) {
    return `A transaction can have at most ${MAX_ATTACHMENTS_PER_TRANSACTION} attachments.`;
  }
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/attachments.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/attachments.ts src/lib/attachments.test.ts
git commit -m "feat: attachment upload validation helpers"
```

---

### Task 3: Backup bytea round-trip

Backups JSON-stringify raw pg rows. `bytea` columns come back as Node Buffers, which stringify into `{"type":"Buffer","data":[...]}` and would be re-inserted corrupted. Encode Buffers to a marker object at export, decode at import.

**Files:**
- Modify: `src/lib/backup/index.ts` (export loops ~lines 53-57 and ~91-110; import values line 266)
- Test: `src/lib/backup/index.test.ts` (append)

**Interfaces:**
- Produces (exported from `src/lib/backup/index.ts`):
  - `encodeBackupRow(row: Record<string, unknown>): Record<string, unknown>`
  - `decodeBackupValue(v: unknown): unknown`

- [ ] **Step 1: Write the failing test**

Append to `src/lib/backup/index.test.ts` (read the file first to match its import style; add the new names to the existing import from `./index`):

```ts
describe("bytea round-trip", () => {
  it("encodes Buffer values to a base64 marker and decodes them back", () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const row = { id: "a1", data: buf, size: 4, createdAt: new Date("2026-07-18T00:00:00Z") };
    const encoded = encodeBackupRow(row);
    expect(Buffer.isBuffer(encoded.data)).toBe(false);

    // Survive the JSON round-trip the backup file goes through.
    const revived = JSON.parse(JSON.stringify(encoded)) as Record<string, unknown>;
    const decoded = decodeBackupValue(revived.data);
    expect(Buffer.isBuffer(decoded)).toBe(true);
    expect((decoded as Buffer).equals(buf)).toBe(true);
  });

  it("passes non-Buffer values through unchanged", () => {
    expect(decodeBackupValue("plain")).toBe("plain");
    expect(decodeBackupValue(42)).toBe(42);
    expect(decodeBackupValue(null)).toBeNull();
    const obj = { a: 1 };
    expect(decodeBackupValue(obj)).toBe(obj);
    expect(encodeBackupRow({ x: "y" })).toEqual({ x: "y" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/backup/index.test.ts`
Expected: FAIL, `encodeBackupRow` not exported.

- [ ] **Step 3: Implement encode/decode and wire into export + import**

In `src/lib/backup/index.ts`, add near the top (after the interfaces):

```ts
// bytea columns come off the wire as Buffers, which JSON.stringify mangles
// into {type:"Buffer",data:[...]}. Wrap them in a marker object with base64
// instead, and unwrap on import, so binary columns survive the round-trip.
const BYTEA_MARKER = "__moolah_bytea__";

export function encodeBackupRow(row: Record<string, unknown>): Record<string, unknown> {
  let changed = false;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (Buffer.isBuffer(v)) {
      out[k] = { [BYTEA_MARKER]: v.toString("base64") };
      changed = true;
    } else {
      out[k] = v;
    }
  }
  return changed ? out : row;
}

export function decodeBackupValue(v: unknown): unknown {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    const b64 = (v as Record<string, unknown>)[BYTEA_MARKER];
    if (typeof b64 === "string") return Buffer.from(b64, "base64");
  }
  return v;
}
```

In `exportAllData` (line ~56), change:

```ts
      out.push({ table: tablename, rows });
```

to:

```ts
      out.push({ table: tablename, rows: rows.map(encodeBackupRow) });
```

In `exportUserData` (line ~109), make the identical change to its `out.push` line.

In `importAllData` (line 266), change:

```ts
        const values = cols.map((c) => row[c]);
```

to:

```ts
        const values = cols.map((c) => decodeBackupValue(row[c]));
```

- [ ] **Step 4: Run the backup test suite**

Run: `npx vitest run src/lib/backup`
Expected: PASS, including the two new tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/backup/index.ts src/lib/backup/index.test.ts
git commit -m "fix: preserve bytea columns through backup export/import"
```

---

### Task 4: Attachment API routes

**Files:**
- Create: `src/app/api/attachments/route.ts` (POST)
- Create: `src/app/api/attachments/[id]/route.ts` (GET, DELETE)
- Test: `src/app/api/attachments/routes.test.ts`

**Interfaces:**
- Consumes: `validateAttachmentUpload`, `AttachmentDTO` from `@/lib/attachments` (Task 2); `requireUser` from `@/lib/session`; `isDemoMode` from `@/lib/demo-guard`.
- Produces HTTP contract used by the client (Task 7):
  - `POST /api/attachments` multipart fields `transactionId`, `file` -> 201 with `AttachmentDTO` JSON (demo mode: 201 with a fake `demo-` prefixed id, nothing persisted). 400 invalid, 401 unauthed, 404 unknown transaction.
  - `GET /api/attachments/:id` -> 200 bytes with stored Content-Type, `Content-Disposition: inline`. 404 when not the session user's row.
  - `DELETE /api/attachments/:id` -> 200 `{ ok: true }`. 404 when not found. Demo mode: 200 without touching the DB.

- [ ] **Step 1: Write the failing tests**

Create `src/app/api/attachments/routes.test.ts`:

```ts
// Contract tests for the attachment route handlers. Session auth and prisma
// are mocked; the validation logic itself is covered in lib/attachments.test.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: vi.fn(() => false) }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    transaction: { findFirst: vi.fn() },
    attachment: { create: vi.fn(), findFirst: vi.fn(), deleteMany: vi.fn() },
  },
}));

import { requireUser } from "@/lib/session";
import { isDemoMode } from "@/lib/demo-guard";
import { prisma } from "@/lib/prisma";
import { POST } from "./route";
import { GET, DELETE } from "./[id]/route";

const user = vi.mocked(requireUser);
const demo = vi.mocked(isDemoMode);
const txnFind = vi.mocked(prisma.transaction.findFirst);
const attCreate = vi.mocked(prisma.attachment.create);
const attFind = vi.mocked(prisma.attachment.findFirst);
const attDeleteMany = vi.mocked(prisma.attachment.deleteMany);

function uploadReq(fields: { transactionId?: string; file?: File }): NextRequest {
  const form = new FormData();
  if (fields.transactionId) form.set("transactionId", fields.transactionId);
  if (fields.file) form.set("file", fields.file);
  return new NextRequest("http://localhost/api/attachments", { method: "POST", body: form });
}

const jpeg = new File([new Uint8Array([1, 2, 3])], "receipt.jpg", { type: "image/jpeg" });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

beforeEach(() => {
  vi.clearAllMocks();
  demo.mockReturnValue(false);
  user.mockResolvedValue({ userId: "u1" } as Awaited<ReturnType<typeof requireUser>>);
});

describe("POST /api/attachments", () => {
  it("401s when unauthenticated", async () => {
    user.mockRejectedValue(new Error("no session"));
    const res = await POST(uploadReq({ transactionId: "t1", file: jpeg }));
    expect(res.status).toBe(401);
  });

  it("400s when transactionId or file is missing", async () => {
    expect((await POST(uploadReq({ file: jpeg }))).status).toBe(400);
    expect((await POST(uploadReq({ transactionId: "t1" }))).status).toBe(400);
  });

  it("404s for a transaction the user does not own", async () => {
    txnFind.mockResolvedValue(null);
    const res = await POST(uploadReq({ transactionId: "t1", file: jpeg }));
    expect(res.status).toBe(404);
  });

  it("400s on validation failure (type)", async () => {
    txnFind.mockResolvedValue({ id: "t1", _count: { attachments: 0 } } as never);
    const bad = new File([new Uint8Array([1])], "x.svg", { type: "image/svg+xml" });
    const res = await POST(uploadReq({ transactionId: "t1", file: bad }));
    expect(res.status).toBe(400);
  });

  it("creates and returns metadata", async () => {
    txnFind.mockResolvedValue({ id: "t1", _count: { attachments: 0 } } as never);
    attCreate.mockResolvedValue({ id: "a1", filename: "receipt.jpg", mimeType: "image/jpeg", size: 3 } as never);
    const res = await POST(uploadReq({ transactionId: "t1", file: jpeg }));
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: "a1", filename: "receipt.jpg", mimeType: "image/jpeg", size: 3 });
    expect(attCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ userId: "u1", transactionId: "t1", mimeType: "image/jpeg" }),
      }),
    );
  });

  it("demo mode: returns fake metadata without writing", async () => {
    demo.mockReturnValue(true);
    const res = await POST(uploadReq({ transactionId: "t1", file: jpeg }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.id).toMatch(/^demo-/);
    expect(attCreate).not.toHaveBeenCalled();
  });
});

describe("GET /api/attachments/[id]", () => {
  it("404s for another user's attachment", async () => {
    attFind.mockResolvedValue(null);
    const res = await GET(new NextRequest("http://localhost/api/attachments/a1"), params("a1"));
    expect(res.status).toBe(404);
    expect(attFind).toHaveBeenCalledWith({ where: { id: "a1", userId: "u1" } });
  });

  it("streams bytes with the stored content type", async () => {
    attFind.mockResolvedValue({
      id: "a1", filename: "receipt.jpg", mimeType: "image/jpeg", size: 3,
      data: Buffer.from([1, 2, 3]),
    } as never);
    const res = await GET(new NextRequest("http://localhost/api/attachments/a1"), params("a1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/jpeg");
    expect(res.headers.get("Content-Disposition")).toContain("inline");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3]));
  });
});

describe("DELETE /api/attachments/[id]", () => {
  it("deletes scoped to the user", async () => {
    attDeleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(new NextRequest("http://localhost/api/attachments/a1", { method: "DELETE" }), params("a1"));
    expect(res.status).toBe(200);
    expect(attDeleteMany).toHaveBeenCalledWith({ where: { id: "a1", userId: "u1" } });
  });

  it("404s when nothing was deleted", async () => {
    attDeleteMany.mockResolvedValue({ count: 0 });
    const res = await DELETE(new NextRequest("http://localhost/api/attachments/a1", { method: "DELETE" }), params("a1"));
    expect(res.status).toBe(404);
  });

  it("demo mode: ok without touching the DB", async () => {
    demo.mockReturnValue(true);
    const res = await DELETE(new NextRequest("http://localhost/api/attachments/a1", { method: "DELETE" }), params("a1"));
    expect(res.status).toBe(200);
    expect(attDeleteMany).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/app/api/attachments/routes.test.ts`
Expected: FAIL, cannot resolve `./route`.

- [ ] **Step 3: Implement the POST handler**

Create `src/app/api/attachments/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { isDemoMode } from "@/lib/demo-guard";
import { prisma } from "@/lib/prisma";
import { validateAttachmentUpload } from "@/lib/attachments";

// POST /api/attachments - multipart form { transactionId, file }.
// A route handler rather than a server action: uploads can exceed the 1MB
// server-action body cap, and downloads need a GET sibling anyway.
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const transactionId = form.get("transactionId");
  const file = form.get("file");
  if (typeof transactionId !== "string" || !transactionId || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing transactionId or file." }, { status: 400 });
  }

  if (isDemoMode()) {
    return NextResponse.json(
      { id: `demo-${Date.now()}`, filename: file.name || "attachment", mimeType: file.type, size: file.size },
      { status: 201 },
    );
  }

  const txn = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    select: { id: true, _count: { select: { attachments: true } } },
  });
  if (!txn) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });

  const invalid = validateAttachmentUpload({
    mimeType: file.type,
    size: file.size,
    existingCount: txn._count.attachments,
  });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const created = await prisma.attachment.create({
    data: {
      userId,
      transactionId,
      filename: file.name || "attachment",
      mimeType: file.type,
      size: bytes.length,
      data: bytes,
    },
    select: { id: true, filename: true, mimeType: true, size: true },
  });
  return NextResponse.json(created, { status: 201 });
}
```

- [ ] **Step 4: Implement the GET/DELETE handlers**

Create `src/app/api/attachments/[id]/route.ts`:

```ts
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { isDemoMode } from "@/lib/demo-guard";
import { prisma } from "@/lib/prisma";

// GET /api/attachments/:id - stream the file inline, scoped to the session user.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const att = await prisma.attachment.findFirst({ where: { id, userId } });
  if (!att) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // filename lands inside a quoted header value; strip quotes so it can't
  // break out of it.
  const safeName = att.filename.replace(/["\r\n]/g, "");
  return new NextResponse(new Uint8Array(att.data), {
    status: 200,
    headers: {
      "Content-Type": att.mimeType,
      "Content-Length": String(att.data.length),
      "Content-Disposition": `inline; filename="${safeName}"`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

// DELETE /api/attachments/:id - remove one attachment, scoped to the session user.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isDemoMode()) return NextResponse.json({ ok: true });
  const { id } = await params;
  const { count } = await prisma.attachment.deleteMany({ where: { id, userId } });
  if (count === 0) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/app/api/attachments/routes.test.ts`
Expected: PASS (10 tests). If `requireUser`'s mocked return type complains, match the real `UserContext` shape from `src/lib/session.ts` in the test's `mockResolvedValue`.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/attachments
git commit -m "feat: attachment upload/download/delete API routes"
```

---

### Task 5: TransactionDTO attachments + create action returns id

**Files:**
- Modify: `src/lib/queries/transactions.ts` (DTO line 13-36, includes lines 111-117/152/201, mapper line 119-141)
- Modify: `src/lib/demo-data.ts` (txn factory ~line 323-341)
- Modify: `src/app/(app)/calendar/calendar-utils.ts` (`eventToTxn` ~line 139-159)
- Modify: `src/actions/transactions.ts` (`createTransactionAction` line 104)

**Interfaces:**
- Consumes: `AttachmentDTO` from `@/lib/attachments` (Task 2).
- Produces:
  - `TransactionDTO.attachments: AttachmentDTO[]` (metadata only)
  - `createTransactionAction(input): Promise<ActionResult & { id?: string }>` where `id` is the new transaction's id on success (undefined in demo mode)

- [ ] **Step 1: Add attachments to the DTO and queries**

In `src/lib/queries/transactions.ts`:

Add to the imports:

```ts
import type { AttachmentDTO } from "@/lib/attachments";
```

In `interface TransactionDTO`, after `tags`:

```ts
  /** Attachment metadata for the paperclip indicator and the modal list. */
  attachments: AttachmentDTO[];
```

Define the select shape once, above `type TransactionRow`:

```ts
const ATTACHMENT_SELECT = { select: { id: true, filename: true, mimeType: true, size: true } } as const;
```

Update `TransactionRow`'s include type and both `findMany` include objects (in `getTransactionsBetween` and `getTransactionsPage`) to add `attachments: ATTACHMENT_SELECT` alongside `tags`. For the `Prisma.TransactionGetPayload` type parameter, spell it out literally:

```ts
type TransactionRow = Prisma.TransactionGetPayload<{
  include: {
    splits: true;
    account: { select: { type: true } };
    tags: { select: { id: true; name: true; color: true } };
    attachments: { select: { id: true; filename: true; mimeType: true; size: true } };
  };
}>;
```

In `toTransactionDTO`, after the `tags` line:

```ts
    attachments: t.attachments.map((a) => ({ id: a.id, filename: a.filename, mimeType: a.mimeType, size: a.size })),
```

- [ ] **Step 2: Fix the other TransactionDTO constructors**

- `src/lib/demo-data.ts` txn factory (~line 340): add `attachments: [],` after `tags: [],`.
- `src/app/(app)/calendar/calendar-utils.ts` `eventToTxn` (~line 157): add `attachments: [],` after `tags: [],`.

Run: `npx tsc --noEmit`
Expected: no errors. If any other file fails on a missing `attachments` property, add `attachments: []` to that literal too.

- [ ] **Step 3: Return the new id from createTransactionAction**

In `src/actions/transactions.ts`, `createTransactionAction` (line 104): change the signature to `Promise<ActionResult & { id?: string }>`, capture the created transaction's id, and return it. The body currently ends with `await tx.transaction.create({ ... })` inside `prisma.$transaction`; change to:

```ts
export async function createTransactionAction(
  input: TransactionInput,
): Promise<ActionResult & { id?: string }> {
  if (isDemoMode()) return { ok: true };
  let createdId: string | undefined;
  const res = await run(async () => {
    // ... existing body unchanged, except:
    //   const created = await tx.transaction.create({ ... same data ... });
    //   createdId = created.id;
    // in place of the bare `await tx.transaction.create({...})`.
  });
  return res.ok ? { ...res, id: createdId } : res;
}
```

Keep every existing line of the body (ownership assert, splits, tags, recurring rule) exactly as it is; only the create call's result is now captured and the wrapper returns the id.

- [ ] **Step 4: Typecheck and run the action/query tests**

Run: `npx tsc --noEmit && npx vitest run src/lib src/app --silent`
Expected: no type errors; existing suites pass (some tests build TransactionDTO literals; add `attachments: []` to any fixture the compiler or a failing test flags, e.g. `src/app/(app)/transactions/transactions-utils.test.ts`, `src/app/(app)/calendar/calendar-utils.test.ts`).

- [ ] **Step 5: Commit**

```bash
git add -A src
git commit -m "feat: expose attachment metadata on TransactionDTO, return id from create action"
```

---

### Task 6: Client image downscaling

**Files:**
- Create: `src/lib/image-downscale.ts`
- Test: `src/lib/image-downscale.test.ts`

**Interfaces:**
- Produces:
  - `MAX_IMAGE_DIMENSION = 2000`
  - `shouldDownscale(mimeType: string): boolean`
  - `scaledDimensions(width: number, height: number, max?: number): { width: number; height: number }`
  - `downscaleImage(file: File): Promise<File>` (browser-only; falls back to the original file on any failure)

- [ ] **Step 1: Write the failing test** (pure helpers only; the canvas path is exercised manually)

Create `src/lib/image-downscale.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { shouldDownscale, scaledDimensions, MAX_IMAGE_DIMENSION } from "./image-downscale";

describe("shouldDownscale", () => {
  it("is true for raster images and false for pdf", () => {
    expect(shouldDownscale("image/jpeg")).toBe(true);
    expect(shouldDownscale("image/heic")).toBe(true);
    expect(shouldDownscale("application/pdf")).toBe(false);
  });
});

describe("scaledDimensions", () => {
  it("leaves small images alone", () => {
    expect(scaledDimensions(800, 600)).toEqual({ width: 800, height: 600 });
  });

  it("caps the long edge and keeps aspect ratio", () => {
    expect(scaledDimensions(4000, 3000)).toEqual({ width: MAX_IMAGE_DIMENSION, height: 1500 });
    expect(scaledDimensions(1000, 4000)).toEqual({ width: 500, height: MAX_IMAGE_DIMENSION });
  });

  it("rounds to whole pixels", () => {
    const { width, height } = scaledDimensions(4001, 3000);
    expect(Number.isInteger(width)).toBe(true);
    expect(Number.isInteger(height)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/image-downscale.test.ts`
Expected: FAIL, cannot resolve module.

- [ ] **Step 3: Implement**

Create `src/lib/image-downscale.ts`:

```ts
// Client-side receipt photo shrinking: phone camera shots are 5-12MB, which
// would bloat the DB fast. Re-encode to JPEG capped at 2000px on the long
// edge before upload. Falls back to the original file whenever the browser
// can't decode it (e.g. HEIC outside Safari) - the server cap still applies.

export const MAX_IMAGE_DIMENSION = 2000;
const JPEG_QUALITY = 0.85;

const DOWNSCALABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"]);

export function shouldDownscale(mimeType: string): boolean {
  return DOWNSCALABLE.has(mimeType);
}

export function scaledDimensions(
  width: number,
  height: number,
  max = MAX_IMAGE_DIMENSION,
): { width: number; height: number } {
  const long = Math.max(width, height);
  if (long <= max) return { width, height };
  const scale = max / long;
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

export async function downscaleImage(file: File): Promise<File> {
  if (!shouldDownscale(file.type)) return file;
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = scaledDimensions(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(bitmap, 0, 0, width, height);
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
    );
    // Keep the original when re-encoding didn't actually help.
    if (!blob || blob.size >= file.size) return file;
    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/image-downscale.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-downscale.ts src/lib/image-downscale.test.ts
git commit -m "feat: client-side image downscaling for receipt uploads"
```

---

### Task 7: AttachmentSection component

**Files:**
- Create: `src/components/AttachmentSection.tsx`

**Interfaces:**
- Consumes: `AttachmentDTO`, limits from `@/lib/attachments`; `downscaleImage` from `@/lib/image-downscale`; API contract from Task 4.
- Produces (used by Task 8):
  - `AttachmentSection` component with props `{ transactionId: string | null; initial: AttachmentDTO[]; staged: File[]; onStagedChange: (files: File[]) => void }`. When `transactionId` is set, uploads/deletes hit the API immediately; when null (creating), files are staged via `staged`/`onStagedChange` for the caller to upload after save.
  - `uploadAttachment(transactionId: string, file: File): Promise<{ ok: true; attachment: AttachmentDTO } | { ok: false; error: string }>` - downscales, POSTs, parses the response.

- [ ] **Step 1: Write the component**

Create `src/components/AttachmentSection.tsx`:

```tsx
"use client";

import { useRef, useState } from "react";
import { FileText, Paperclip, Trash2, X } from "lucide-react";
import {
  MAX_ATTACHMENTS_PER_TRANSACTION,
  validateAttachmentUpload,
  type AttachmentDTO,
} from "@/lib/attachments";
import { downscaleImage } from "@/lib/image-downscale";
import { useConfirmAction } from "@/lib/useConfirmAction";

const ACCEPT = "image/jpeg,image/png,image/webp,image/heic,image/heif,application/pdf";

export async function uploadAttachment(
  transactionId: string,
  file: File,
): Promise<{ ok: true; attachment: AttachmentDTO } | { ok: false; error: string }> {
  const prepared = await downscaleImage(file);
  const form = new FormData();
  form.set("transactionId", transactionId);
  form.set("file", prepared);
  const res = await fetch("/api/attachments", { method: "POST", body: form });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    return { ok: false, error: body?.error ?? "Upload failed." };
  }
  return { ok: true, attachment: (await res.json()) as AttachmentDTO };
}

function prettySize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(bytes / 1024))}KB`;
}

export interface AttachmentSectionProps {
  /** Null while creating: files are staged and uploaded after save. */
  transactionId: string | null;
  initial: AttachmentDTO[];
  staged: File[];
  onStagedChange: (files: File[]) => void;
}

export function AttachmentSection(props: AttachmentSectionProps) {
  const { transactionId, initial, staged, onStagedChange } = props;
  const [items, setItems] = useState<AttachmentDTO[]>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<AttachmentDTO | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const count = transactionId ? items.length : staged.length;
  const full = count >= MAX_ATTACHMENTS_PER_TRANSACTION;

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    setError(null);
    void (async () => {
      for (const file of Array.from(files)) {
        const currentCount = transactionId ? items.length : staged.length;
        const invalid = validateAttachmentUpload({
          mimeType: file.type,
          size: file.size,
          existingCount: currentCount,
        });
        if (invalid) {
          setError(invalid);
          return;
        }
        if (!transactionId) {
          onStagedChange([...staged, file]);
          continue;
        }
        setBusy(true);
        const res = await uploadAttachment(transactionId, file);
        setBusy(false);
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setItems((prev) => [...prev, res.attachment]);
      }
    })();
  };

  const remove = (att: AttachmentDTO) =>
    void (async () => {
      const res = await fetch(`/api/attachments/${att.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't delete that attachment.");
        return;
      }
      setItems((prev) => prev.filter((a) => a.id !== att.id));
    })();

  return (
    <div>
      <div className="flex items-center justify-between">
        <label className="label">Attachments</label>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy || full}
          className="text-xs text-muted underline hover:text-text disabled:opacity-50"
        >
          {busy ? "Uploading…" : full ? `Max ${MAX_ATTACHMENTS_PER_TRANSACTION}` : "Add file"}
        </button>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        multiple
        capture="environment"
        className="hidden"
        onChange={(e) => {
          addFiles(e.target.files);
          e.target.value = "";
        }}
      />

      {transactionId ? (
        items.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {items.map((att) => (
              <AttachmentChip key={att.id} att={att} onOpen={() => openAttachment(att, setLightbox)} onDelete={() => remove(att)} />
            ))}
          </ul>
        )
      ) : (
        staged.length > 0 && (
          <ul className="mt-2 flex flex-wrap gap-2">
            {staged.map((file, i) => (
              <li key={`${file.name}-${i}`} className="flex items-center gap-1.5 rounded-lg border border-line px-2 py-1 text-xs">
                <Paperclip size={12} className="text-muted" />
                <span className="max-w-40 truncate">{file.name}</span>
                <span className="text-muted">{prettySize(file.size)}</span>
                <button
                  type="button"
                  aria-label={`Remove ${file.name}`}
                  onClick={() => onStagedChange(staged.filter((_, j) => j !== i))}
                  className="text-muted hover:text-text"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )
      )}

      {error && <p className="mt-1 text-xs text-expense">{error}</p>}

      {lightbox && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6"
          onClick={() => setLightbox(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/api/attachments/${lightbox.id}`}
            alt={lightbox.filename}
            className="max-h-full max-w-full rounded-lg object-contain"
          />
        </div>
      )}
    </div>
  );
}

function openAttachment(att: AttachmentDTO, setLightbox: (a: AttachmentDTO | null) => void) {
  if (att.mimeType === "application/pdf") {
    window.open(`/api/attachments/${att.id}`, "_blank", "noopener");
  } else {
    setLightbox(att);
  }
}

function AttachmentChip(props: { att: AttachmentDTO; onOpen: () => void; onDelete: () => void }) {
  const { att, onOpen, onDelete } = props;
  const confirmDelete = useConfirmAction(onDelete);
  const isPdf = att.mimeType === "application/pdf";
  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onOpen}
        title={att.filename}
        className="block overflow-hidden rounded-lg border border-line hover:border-text/30"
      >
        {isPdf ? (
          <span className="flex h-16 w-16 flex-col items-center justify-center gap-1 text-muted">
            <FileText size={20} />
            <span className="text-[10px]">PDF</span>
          </span>
        ) : (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img src={`/api/attachments/${att.id}`} alt={att.filename} className="h-16 w-16 object-cover" />
        )}
      </button>
      <button
        type="button"
        aria-label={`Delete ${att.filename}`}
        onClick={confirmDelete.trigger}
        className={`absolute -right-1.5 -top-1.5 rounded-full border border-line bg-surface p-1 shadow-sm ${
          confirmDelete.armed ? "text-expense" : "text-muted opacity-0 transition-opacity group-hover:opacity-100"
        }`}
      >
        <Trash2 size={11} />
      </button>
    </li>
  );
}
```

Before writing, read `src/lib/useConfirmAction.ts` to confirm the `{ trigger, armed }` shape matches how `TransactionModal` uses it (line 170, 357-358); adjust to the real API if it differs.

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npx next lint --file src/components/AttachmentSection.tsx`
Expected: clean. If `next lint` isn't available in this Next version, use `npx eslint src/components/AttachmentSection.tsx`.

- [ ] **Step 3: Commit**

```bash
git add src/components/AttachmentSection.tsx
git commit -m "feat: attachment section component with upload, lightbox, and staging"
```

---

### Task 8: Wire attachments into TransactionModal

**Files:**
- Modify: `src/components/TransactionModal.tsx`

**Interfaces:**
- Consumes: `AttachmentSection`, `uploadAttachment` (Task 7); `createTransactionAction` now returning `{ ok: true; id?: string }` (Task 5); `transaction.attachments` on the DTO (Task 5).

- [ ] **Step 1: Add state + section to the modal**

In `src/components/TransactionModal.tsx`:

Add imports:

```ts
import { AttachmentSection, uploadAttachment } from "./AttachmentSection";
```

Add state after the `splits` state (line ~83):

```ts
  const [stagedFiles, setStagedFiles] = useState<File[]>([]);
```

Render the section after the Note block (after line 296) and before the Tags block:

```tsx
        <AttachmentSection
          transactionId={transaction?.id ?? null}
          initial={transaction?.attachments ?? []}
          staged={stagedFiles}
          onStagedChange={setStagedFiles}
        />
```

- [ ] **Step 2: Upload staged files after create**

In `submit()` (line 122-150), the create branch currently does:

```ts
      const res = editing
        ? await updateTransactionAction(transaction!.id, payload(null))
        : await createTransactionAction(payload(form.recurring ? recurringInput : null));
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
```

After the `if (!res.ok)` block, add:

```ts
      // Files picked before the transaction existed upload now, keyed to the
      // new id. Failures keep the saved transaction and just report the file.
      if (!editing && stagedFiles.length > 0 && "id" in res && res.id) {
        for (const file of stagedFiles) {
          const up = await uploadAttachment(res.id, file);
          if (!up.ok) toast({ message: `Couldn't attach ${file.name}: ${up.error}` });
        }
      }
```

(`toast` already exists in scope, line 86. In demo mode `res.id` is undefined, so staged uploads are skipped, which matches the other no-op demo writes.)

- [ ] **Step 3: Typecheck, lint, run component-adjacent tests**

Run: `npx tsc --noEmit && npx vitest run src/components src/app --silent`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/components/TransactionModal.tsx
git commit -m "feat: attachment upload and management in the transaction modal"
```

---

### Task 9: Paperclip indicator in the transactions list

**Files:**
- Modify: `src/app/(app)/transactions/TransactionsList.tsx` (row markup ~line 604-628)

**Interfaces:**
- Consumes: `TransactionDTO.attachments` (Task 5).

- [ ] **Step 1: Add the icon**

In `TransactionsList.tsx`, add `Paperclip` to the existing `lucide-react` import. In the row markup, directly after the `StickyNote` note indicator (line 607-609), add:

```tsx
                      {t.attachments.length > 0 && (
                        <Paperclip size={12} className="ml-1.5 inline align-middle text-muted" aria-label="Has attachments" />
                      )}
```

- [ ] **Step 2: Typecheck and lint**

Run: `npx tsc --noEmit && npx eslint "src/app/(app)/transactions/TransactionsList.tsx"`
Expected: clean.

- [ ] **Step 3: Commit**

```bash
git add "src/app/(app)/transactions/TransactionsList.tsx"
git commit -m "feat: paperclip indicator on transactions with attachments"
```

---

### Task 10: Full verification

- [ ] **Step 1: Full test suite + typecheck + lint + build**

Run: `npx tsc --noEmit && npx vitest run && npm run lint && npm run build`
Expected: everything passes. Fix anything that fails before proceeding (missing `attachments: []` in test fixtures is the likely culprit).

- [ ] **Step 2: End-to-end manual verification**

Use the `verify` skill (build, launch, drive the app) to confirm:
1. Add a transaction with a staged image; after save, editing it shows the thumbnail.
2. Upload a PDF to an existing transaction; it opens in a new tab.
3. Delete an attachment (confirm step) and see it disappear.
4. Paperclip shows on the row in the list.
5. An oversized (>10MB) or wrong-type file shows the validation error.

- [ ] **Step 3: Update the roadmap**

Move the "Receipt & document attachments" bullet in `README.md` (line ~34) into the "Recently shipped" section, rewording to past tense in the same style as its neighbors.

```bash
git add README.md
git commit -m "docs: move receipt attachments to recently shipped"
```
