// Validation/auth guards for the backup import route. The actual DB load
// (importAllData) is mocked and covered separately in src/lib/backup.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/backup", () => ({ importAllData: vi.fn() }));

import { auth } from "@/auth";
import { importAllData } from "@/lib/backup";
import { POST } from "./route";

const authMock = vi.mocked(auth);
const importMock = vi.mocked(importAllData);

function post(body: string): NextRequest {
  return new NextRequest("http://localhost/api/backup/import", { method: "POST", body });
}

const validBackup = JSON.stringify({
  app: "moolah",
  version: 1,
  exportedAt: "2026-06-14T00:00:00.000Z",
  tables: [{ table: "User", rows: [{ id: "u1" }] }],
});

beforeEach(() => {
  vi.clearAllMocks();
  authMock.mockResolvedValue({ user: { id: "u1" } } as never);
});

describe("POST /api/backup/import", () => {
  it("401s when not signed in", async () => {
    authMock.mockResolvedValue(null as never);
    const res = await POST(post(validBackup));
    expect(res.status).toBe(401);
    expect(importMock).not.toHaveBeenCalled();
  });

  it("400s on invalid JSON", async () => {
    const res = await POST(post("not json"));
    expect(res.status).toBe(400);
    expect(importMock).not.toHaveBeenCalled();
  });

  it("400s when the file isn't a Moolah backup", async () => {
    const res = await POST(post(JSON.stringify({ app: "other", tables: [] })));
    expect(res.status).toBe(400);
    expect(importMock).not.toHaveBeenCalled();
  });

  it("force-imports a valid backup and returns counts", async () => {
    importMock.mockResolvedValue({ imported: 3, tables: 1 });
    const res = await POST(post(validBackup));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, imported: 3, tables: 1 });
    expect(importMock).toHaveBeenCalledWith(expect.objectContaining({ app: "moolah" }), undefined, {
      force: true,
    });
  });

  it("500s when the import throws", async () => {
    importMock.mockRejectedValue(new Error("boom"));
    const res = await POST(post(validBackup));
    expect(res.status).toBe(500);
    await expect(res.json()).resolves.toEqual({ error: "boom" });
  });
});
