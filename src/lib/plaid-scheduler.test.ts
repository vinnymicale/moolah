import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import cron from "node-cron";
import { sweepPlaid } from "./plaid-sweep";
import { _resetSchedulerForTests, startPlaidSyncScheduler, sweep } from "./plaid-scheduler";

vi.mock("node-cron", () => ({
  default: { schedule: vi.fn(() => ({ stop: vi.fn() })), validate: vi.fn(() => true) },
}));
vi.mock("./plaid-sweep", async (orig) => ({
  ...(await orig<typeof import("./plaid-sweep")>()),
  sweepPlaid: vi.fn(),
}));

const NO_CHANGES = {
  synced: 0, failed: 0, added: 0, modified: 0, removed: 0, balancesUpdated: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cron.validate).mockReturnValue(true);
  vi.mocked(sweepPlaid).mockResolvedValue(NO_CHANGES);
});
afterEach(() => _resetSchedulerForTests());

describe("startPlaidSyncScheduler", () => {
  it("registers a single cron task, idempotently", async () => {
    await startPlaidSyncScheduler();
    await startPlaidSyncScheduler();
    expect(cron.schedule).toHaveBeenCalledOnce();
    expect(vi.mocked(cron.schedule).mock.calls[0][0]).toBe("*/30 * * * *");
  });

  it("does not schedule anything when the cron expression is invalid", async () => {
    vi.mocked(cron.validate).mockReturnValue(false);
    await startPlaidSyncScheduler();
    expect(cron.schedule).not.toHaveBeenCalled();
  });

  it("keeps the timer alive when a tick throws", async () => {
    vi.mocked(sweepPlaid).mockRejectedValue(new Error("plaid down"));
    await startPlaidSyncScheduler();
    const tick = vi.mocked(cron.schedule).mock.calls[0][1] as () => Promise<void>;
    await expect(tick()).resolves.toBeUndefined();
  });
});

describe("sweep", () => {
  it("sweeps across every user, unscoped and unforced", async () => {
    await sweep();
    expect(sweepPlaid).toHaveBeenCalledWith({});
  });

  it("skips a tick that would overlap one already running", async () => {
    let release!: () => void;
    vi.mocked(sweepPlaid).mockReturnValueOnce(
      new Promise((resolve) => {
        release = () => resolve(NO_CHANGES);
      }),
    );

    const first = sweep();
    await sweep(); // lands while the first is still in flight
    expect(sweepPlaid).toHaveBeenCalledOnce();

    release();
    await first;

    // Once the first finishes, the next tick runs normally.
    await sweep();
    expect(sweepPlaid).toHaveBeenCalledTimes(2);
  });

  it("releases the overlap guard when a sweep throws", async () => {
    vi.mocked(sweepPlaid).mockRejectedValueOnce(new Error("boom"));
    await expect(sweep()).rejects.toThrow("boom");
    await sweep();
    expect(sweepPlaid).toHaveBeenCalledTimes(2);
  });
});
