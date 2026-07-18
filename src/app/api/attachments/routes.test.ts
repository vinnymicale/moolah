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

  it("serves a unicode filename without crashing, ASCII-safe with a filename* fallback", async () => {
    attFind.mockResolvedValue({
      id: "a1", filename: "レシート ☕.jpg", mimeType: "image/jpeg", size: 3,
      data: Buffer.from([1, 2, 3]),
    } as never);
    const res = await GET(new NextRequest("http://localhost/api/attachments/a1"), params("a1"));
    expect(res.status).toBe(200);
    const disposition = res.headers.get("Content-Disposition") ?? "";
    expect(disposition).toMatch(/^[\x20-\x7E]*$/);
    expect(disposition).toContain("filename*=UTF-8''");
    expect(disposition).toContain(encodeURIComponent("レシート ☕.jpg"));
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
