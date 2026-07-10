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
