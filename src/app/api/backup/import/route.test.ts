// Validation/auth guards for the backup import route. The actual DB load
// (importAllData) is mocked and covered separately in src/lib/backup.test.ts.
//
// Restore wipes the instance, so the password re-auth in front of it is a
// security boundary and gets direct coverage here.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/backup", () => ({ importAllData: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { findUnique: vi.fn() } } }));
vi.mock("bcryptjs", () => ({ compare: vi.fn() }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));

import { auth } from "@/auth";
import { importAllData } from "@/lib/backup";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limit";
import { POST } from "./route";

const authMock = vi.mocked(auth);
const importMock = vi.mocked(importAllData);
const findUser = vi.mocked(prisma.user.findUnique);
const compareMock = vi.mocked(compare);
const rateLimit = vi.mocked(checkRateLimit);

function post(body: string): NextRequest {
  return new NextRequest("http://localhost/api/backup/import", { method: "POST", body });
}

const backup = {
  app: "moolah",
  version: 1,
  exportedAt: "2026-06-14T00:00:00.000Z",
  tables: [{ table: "User", rows: [{ id: "u1" }] }],
};

const validBody = JSON.stringify({ password: "hunter2", payload: backup });

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } } as never);
  findUser.mockResolvedValue({ passwordHash: "hashed" } as never);
  compareMock.mockResolvedValue(true as never);
  rateLimit.mockReturnValue({ allowed: true } as never);
});

describe("POST /api/backup/import", () => {
  it("401s when not signed in", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await POST(post(validBody));
    expect(res.status).toBe(401);
    expect(importMock).not.toHaveBeenCalled();
  });

  it("400s on invalid JSON", async () => {
    const res = await POST(post("not json"));
    expect(res.status).toBe(400);
    expect(importMock).not.toHaveBeenCalled();
  });

  it("400s when the file isn't a Moolah backup", async () => {
    const res = await POST(post(JSON.stringify({ password: "hunter2", payload: { app: "other", tables: [] } })));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({
      error: "That doesn't look like a Moolah backup file.",
    });
    expect(importMock).not.toHaveBeenCalled();
  });

  it("400s when the password is missing", async () => {
    const res = await POST(post(JSON.stringify({ payload: backup })));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ error: "Enter your password to confirm." });
    expect(importMock).not.toHaveBeenCalled();
  });

  it("403s when the password is wrong, without importing", async () => {
    compareMock.mockResolvedValue(false as never);
    const res = await POST(post(validBody));
    expect(res.status).toBe(403);
    expect(importMock).not.toHaveBeenCalled();
  });

  it("429s once re-auth attempts are exhausted", async () => {
    rateLimit.mockReturnValue({ allowed: false } as never);
    const res = await POST(post(validBody));
    expect(res.status).toBe(429);
    expect(compareMock).not.toHaveBeenCalled();
    expect(importMock).not.toHaveBeenCalled();
  });

  it("skips the password check for a bypass account that has none", async () => {
    findUser.mockResolvedValue({ passwordHash: null } as never);
    importMock.mockResolvedValue({ imported: 3, tables: 1 });
    const res = await POST(post(validBody));
    expect(res.status).toBe(200);
    expect(compareMock).not.toHaveBeenCalled();
  });

  it("force-imports a valid backup and returns counts", async () => {
    importMock.mockResolvedValue({ imported: 3, tables: 1 });
    const res = await POST(post(validBody));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, imported: 3, tables: 1 });
    expect(importMock).toHaveBeenCalledWith(expect.objectContaining({ app: "moolah" }), undefined, {
      force: true,
    });
  });

  it("500s when the import throws", async () => {
    importMock.mockRejectedValue(new Error("boom"));
    const res = await POST(post(validBody));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "boom" });
  });
});
