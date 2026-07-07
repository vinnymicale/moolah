// Action-layer tests for backup.ts. saveBackupConfigAction carries the logic
// worth covering: the demo/auth guards, input validation (destination, schedule,
// keepCount), the "connect Google Drive before enabling it" gate, and the rule
// that a blank credentials blob never overwrites a stored connection.
// runBackupNowAction's success and error mapping are covered too. DB, crypto,
// the scheduler, and the run core are all stubbed.

import { describe, it, expect, vi, beforeEach } from "vitest";

const demoMode = { value: false };
vi.mock("@/lib/demo-guard", () => ({ isDemoMode: () => demoMode.value }));

const session = { value: { user: { id: "u1" } } as { user: { id: string } } | null };
vi.mock("@/auth", () => ({ auth: () => Promise.resolve(session.value) }));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// Deterministic, identifiable "encryption" so we can assert it was applied
// without pulling in real crypto/key setup.
vi.mock("@/lib/crypto", () => ({
  encryptSecret: (s: string) => `enc(${s})`,
}));

const { rescheduleUser } = vi.hoisted(() => ({ rescheduleUser: vi.fn() }));
vi.mock("@/lib/backup/scheduler", () => ({ rescheduleUser }));

const { runScheduledBackupForUser, performBackup } = vi.hoisted(() => ({
  runScheduledBackupForUser: vi.fn(),
  performBackup: vi.fn(),
}));
vi.mock("@/lib/backup/run", () => ({ runScheduledBackupForUser, performBackup }));

vi.mock("@/lib/backup/local", () => ({ LocalDestination: class {} }));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    backupConfig: { findUnique: vi.fn(), upsert: vi.fn() },
  },
}));

import { saveBackupConfigAction, runBackupNowAction, runLocalBackupNowAction } from "./backup";
import { LocalDestination } from "@/lib/backup/local";
import { prisma } from "@/lib/prisma";

const findUnique = vi.mocked(prisma.backupConfig.findUnique);
const upsert = vi.mocked(prisma.backupConfig.upsert);

const dailySchedule = { frequency: "daily" as const, hour: 3 };

function baseInput(over: Partial<Parameters<typeof saveBackupConfigAction>[0]> = {}) {
  return {
    enabled: false,
    destination: "local",
    schedule: dailySchedule,
    keepCount: 7,
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  demoMode.value = false;
  session.value = { user: { id: "u1" } };
  findUnique.mockResolvedValue(null as never);
  upsert.mockResolvedValue({} as never);
});

describe("saveBackupConfigAction", () => {
  it("is a no-op success in demo mode", async () => {
    demoMode.value = true;
    const res = await saveBackupConfigAction(baseInput());
    expect(res).toEqual({ ok: true });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("fails when not signed in", async () => {
    session.value = null;
    const res = await saveBackupConfigAction(baseInput());
    expect(res).toEqual({ ok: false, error: "Not signed in." });
    expect(upsert).not.toHaveBeenCalled();
  });

  it("rejects an unknown destination", async () => {
    const res = await saveBackupConfigAction(baseInput({ destination: "s3" }));
    expect(res).toEqual({ ok: false, error: "Invalid destination." });
  });

  it("rejects an invalid schedule", async () => {
    const res = await saveBackupConfigAction(
      baseInput({ schedule: { frequency: "daily", hour: 99 } }),
    );
    expect(res).toEqual({ ok: false, error: "Invalid schedule." });
  });

  it("rejects an out-of-range keepCount", async () => {
    expect(await saveBackupConfigAction(baseInput({ keepCount: 0 }))).toEqual({
      ok: false,
      error: "Keep count must be between 1 and 365.",
    });
    expect(await saveBackupConfigAction(baseInput({ keepCount: 366 }))).toEqual({
      ok: false,
      error: "Keep count must be between 1 and 365.",
    });
  });

  it("saves a local config and tells the scheduler to re-read it", async () => {
    const res = await saveBackupConfigAction(
      baseInput({ enabled: true, schedule: { frequency: "weekly", hour: 4, weekday: 1 } }),
    );
    expect(res).toEqual({ ok: true });
    const arg = upsert.mock.calls[0][0];
    expect(arg.where).toEqual({ userId: "u1" });
    expect(arg.update.cron).toBe("0 4 * * 1");
    expect(arg.update.enabled).toBe(true);
    // No credentials field written for local.
    expect("credentials" in arg.update).toBe(false);
    expect(rescheduleUser).toHaveBeenCalledWith("u1");
  });

  it("encrypts and stores credentials when supplied", async () => {
    const credentials = {
      clientId: "cid",
      clientSecret: "csecret",
      refreshToken: "rt",
      folderId: "f1",
    };
    await saveBackupConfigAction(baseInput({ destination: "gdrive", credentials }));
    const arg = upsert.mock.calls[0][0];
    expect(arg.update.credentials).toBe(`enc(${JSON.stringify(credentials)})`);
  });

  it("does not overwrite stored credentials when the blob is blank", async () => {
    await saveBackupConfigAction(
      baseInput({
        destination: "gdrive",
        credentials: { clientId: "", clientSecret: "", refreshToken: "", folderId: "" },
      }),
    );
    const arg = upsert.mock.calls[0][0];
    expect("credentials" in arg.update).toBe(false);
  });

  it("refuses to enable gdrive when it isn't connected", async () => {
    findUnique.mockResolvedValue(null as never);
    const res = await saveBackupConfigAction(
      baseInput({ destination: "gdrive", enabled: true }),
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.error).toMatch(/Connect Google Drive first/);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("allows enabling gdrive when credentials are already stored", async () => {
    findUnique.mockResolvedValue({ credentials: "enc(old)" } as never);
    const res = await saveBackupConfigAction(
      baseInput({ destination: "gdrive", enabled: true }),
    );
    expect(res).toEqual({ ok: true });
    expect(upsert).toHaveBeenCalled();
  });

  it("allows enabling gdrive when fresh credentials are supplied in the same save", async () => {
    findUnique.mockResolvedValue(null as never);
    const res = await saveBackupConfigAction(
      baseInput({
        destination: "gdrive",
        enabled: true,
        credentials: { clientId: "a", clientSecret: "b", refreshToken: "c", folderId: "d" },
      }),
    );
    expect(res).toEqual({ ok: true });
    // It shouldn't need to look up existing creds when fresh ones are given.
    expect(findUnique).not.toHaveBeenCalled();
  });
});

describe("runBackupNowAction", () => {
  it("is blocked in demo mode", async () => {
    demoMode.value = true;
    const res = await runBackupNowAction();
    expect(res).toEqual({ ok: false, error: "Not available in demo mode." });
    expect(runScheduledBackupForUser).not.toHaveBeenCalled();
  });

  it("fails when not signed in", async () => {
    session.value = null;
    expect(await runBackupNowAction()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("returns the backup name and pruned count on success", async () => {
    runScheduledBackupForUser.mockResolvedValue({
      name: "moolah-backup-2026-06-20_03-00-00.json",
      bytes: 123,
      pruned: ["old-1.json", "old-2.json"],
    });
    const res = await runBackupNowAction();
    expect(res).toEqual({
      ok: true,
      name: "moolah-backup-2026-06-20_03-00-00.json",
      pruned: 2,
    });
  });

  it("maps a thrown error to a failure result", async () => {
    runScheduledBackupForUser.mockRejectedValue(new Error("disk full"));
    const res = await runBackupNowAction();
    expect(res).toEqual({ ok: false, error: "disk full" });
  });
});

describe("runLocalBackupNowAction", () => {
  it("is blocked in demo mode", async () => {
    demoMode.value = true;
    const res = await runLocalBackupNowAction();
    expect(res).toEqual({ ok: false, error: "Not available in demo mode." });
    expect(performBackup).not.toHaveBeenCalled();
  });

  it("fails when not signed in", async () => {
    session.value = null;
    expect(await runLocalBackupNowAction()).toEqual({ ok: false, error: "Not signed in." });
  });

  it("backs up to a LocalDestination with the configured keepCount", async () => {
    findUnique.mockResolvedValue({ keepCount: 30 } as never);
    performBackup.mockResolvedValue({
      name: "moolah-backup-2026-07-07_10-00-00.json",
      bytes: 456,
      pruned: ["old.json"],
    });
    const res = await runLocalBackupNowAction();
    expect(res).toEqual({
      ok: true,
      name: "moolah-backup-2026-07-07_10-00-00.json",
      pruned: 1,
    });
    const [dest, keepCount] = performBackup.mock.calls[0];
    expect(dest).toBeInstanceOf(LocalDestination);
    expect(keepCount).toBe(30);
  });

  it("defaults keepCount to 7 with no config row", async () => {
    findUnique.mockResolvedValue(null as never);
    performBackup.mockResolvedValue({ name: "n.json", bytes: 1, pruned: [] });
    await runLocalBackupNowAction();
    expect(performBackup.mock.calls[0][1]).toBe(7);
  });

  it("maps a thrown error to a failure result", async () => {
    findUnique.mockResolvedValue(null as never);
    performBackup.mockRejectedValue(new Error("EACCES: permission denied"));
    const res = await runLocalBackupNowAction();
    expect(res).toEqual({ ok: false, error: "EACCES: permission denied" });
  });
});
