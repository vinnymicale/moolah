// Auth guards for the backup download. The file carries every member's login and
// the household's Plaid credentials, so the admin gate is a security boundary and
// gets direct coverage here. exportAllData itself is mocked; its contents are
// covered in src/lib/backup/index.test.ts.

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/household", () => ({ householdForRoute: vi.fn() }));
vi.mock("@/lib/backup", () => ({
  exportAllData: vi.fn(),
  backupStamp: vi.fn(() => "2026-06-14-000000"),
}));

import { householdForRoute } from "@/lib/household";
import { exportAllData } from "@/lib/backup";
import { GET } from "./route";

const forRoute = vi.mocked(householdForRoute);
const exportMock = vi.mocked(exportAllData);

const payload = {
  app: "moolah" as const,
  version: 1 as const,
  exportedAt: "2026-06-14T00:00:00.000Z",
  tables: [{ table: "User", rows: [{ id: "u1" }] }],
};

beforeEach(() => {
  vi.clearAllMocks();
  forRoute.mockResolvedValue({ ctx: { isAdmin: true } } as never);
  exportMock.mockResolvedValue(payload as never);
});

describe("GET /api/backup", () => {
  it("passes through the 401 when not signed in", async () => {
    const unauthorized = Response.json({ error: "Unauthorized" }, { status: 401 });
    forRoute.mockResolvedValue({ response: unauthorized } as never);

    const res = await GET();
    expect(res.status).toBe(401);
    expect(exportMock).not.toHaveBeenCalled();
  });

  it("403s a non-admin member, without exporting", async () => {
    forRoute.mockResolvedValue({ ctx: { isAdmin: false } } as never);

    const res = await GET();
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({
      error: "Only a household admin can export data.",
    });
    expect(exportMock).not.toHaveBeenCalled();
  });

  it("serves the full database as an attachment for an admin", async () => {
    const res = await GET();

    expect(res.status).toBe(200);
    // No argument: the dump is the whole instance, not a per-caller subset.
    expect(exportMock).toHaveBeenCalledWith();
    expect(res.headers.get("Content-Disposition")).toBe(
      'attachment; filename="moolah-backup-2026-06-14-000000.json"',
    );
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    await expect(res.json()).resolves.toEqual(payload);
  });
});
