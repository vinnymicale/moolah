// Tests for performBackup: it exports the DB, writes a timestamped file to the
// destination, then prunes the oldest beyond keepCount - and never prunes if the
// write fails. We stub exportAllData and use an in-memory fake destination.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { exportAllData } = vi.hoisted(() => ({ exportAllData: vi.fn() }));
vi.mock("./index", async () => {
  const actual = await vi.importActual<typeof import("./index")>("./index");
  return { ...actual, exportAllData };
});

import { performBackup } from "./run";
import type { BackupDestination, StoredBackup } from "./destination";

class FakeDestination implements BackupDestination {
  store = new Map<string, Buffer>();
  putErr: Error | null = null;
  constructor(seed: string[] = []) {
    for (const n of seed) this.store.set(n, Buffer.from("{}"));
  }
  async put(name: string, data: Buffer) {
    if (this.putErr) throw this.putErr;
    this.store.set(name, data);
  }
  async list(): Promise<StoredBackup[]> {
    return [...this.store.keys()].map((name) => ({ name }));
  }
  async delete(name: string) {
    this.store.delete(name);
  }
}

beforeEach(() => {
  exportAllData.mockReset();
  exportAllData.mockResolvedValue({
    app: "moolah",
    version: 1,
    exportedAt: "2026-06-20T10:00:00.000Z",
    tables: [],
  });
});

describe("performBackup", () => {
  it("writes a timestamped backup named from exportedAt", async () => {
    exportAllData.mockResolvedValue({
      app: "moolah",
      version: 1,
      exportedAt: "2026-06-20T10:00:00.000Z",
      tables: [{ table: "User", rows: [{ id: "u1" }] }],
    });
    const dest = new FakeDestination();
    const res = await performBackup(dest, 5);

    expect(res.name).toBe("moolah-backup-2026-06-20_10-00-00.json");
    expect(dest.store.has(res.name)).toBe(true);
    expect(res.pruned).toEqual([]);
    // The stored bytes are the JSON payload.
    expect(JSON.parse(dest.store.get(res.name)!.toString()).app).toBe("moolah");
  });

  it("prunes the oldest backups beyond keepCount", async () => {
    exportAllData.mockResolvedValue({
      app: "moolah",
      version: 1,
      exportedAt: "2026-06-20T10:00:00.000Z",
      tables: [],
    });
    const dest = new FakeDestination([
      "moolah-backup-2026-06-17_03-00-00.json",
      "moolah-backup-2026-06-18_03-00-00.json",
      "moolah-backup-2026-06-19_03-00-00.json",
    ]);
    // keepCount 3, plus the new one = 4 total, so the oldest is pruned.
    const res = await performBackup(dest, 3);

    expect(res.pruned).toEqual(["moolah-backup-2026-06-17_03-00-00.json"]);
    expect(dest.store.has("moolah-backup-2026-06-17_03-00-00.json")).toBe(false);
    expect(dest.store.size).toBe(3);
  });

  it("does not prune when the write fails", async () => {
    const dest = new FakeDestination(["moolah-backup-2026-06-19_03-00-00.json"]);
    dest.putErr = new Error("disk full");
    await expect(performBackup(dest, 1)).rejects.toThrow("disk full");
    // The pre-existing backup is untouched.
    expect(dest.store.has("moolah-backup-2026-06-19_03-00-00.json")).toBe(true);
  });
});
