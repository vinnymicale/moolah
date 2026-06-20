// Tests for the scheduler's bookkeeping: which configs get a cron task, that
// rescheduling replaces an existing task, and that startScheduler is idempotent.
// node-cron and prisma are mocked - we assert on schedule/stop calls, not on any
// real timer firing.

import { describe, it, expect, vi, beforeEach } from "vitest";

const { schedule, validate } = vi.hoisted(() => ({
  schedule: vi.fn(),
  validate: vi.fn(() => true),
}));
vi.mock("node-cron", () => ({
  default: { schedule, validate },
  schedule,
  validate,
}));

const { findUnique, findMany } = vi.hoisted(() => ({
  findUnique: vi.fn(),
  findMany: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { backupConfig: { findUnique, findMany } },
}));

vi.mock("./run", () => ({ runScheduledBackupForUser: vi.fn() }));

import {
  rescheduleUser,
  startScheduler,
  _resetSchedulerForTests,
} from "./scheduler";

function fakeTask() {
  return { stop: vi.fn(), destroy: vi.fn() };
}

beforeEach(() => {
  _resetSchedulerForTests();
  schedule.mockReset().mockImplementation(() => fakeTask());
  validate.mockReset().mockReturnValue(true);
  findUnique.mockReset();
  findMany.mockReset();
});

describe("rescheduleUser", () => {
  it("schedules a task for an enabled config", async () => {
    findUnique.mockResolvedValue({ userId: "u1", enabled: true, cron: "0 3 * * *" });
    await rescheduleUser("u1");
    expect(schedule).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledWith("0 3 * * *", expect.any(Function));
  });

  it("does not schedule when the config is disabled", async () => {
    findUnique.mockResolvedValue({ userId: "u1", enabled: false, cron: "0 3 * * *" });
    await rescheduleUser("u1");
    expect(schedule).not.toHaveBeenCalled();
  });

  it("does not schedule when there is no config", async () => {
    findUnique.mockResolvedValue(null);
    await rescheduleUser("u1");
    expect(schedule).not.toHaveBeenCalled();
  });

  it("skips an invalid cron expression", async () => {
    validate.mockReturnValue(false);
    findUnique.mockResolvedValue({ userId: "u1", enabled: true, cron: "not a cron" });
    await rescheduleUser("u1");
    expect(schedule).not.toHaveBeenCalled();
  });

  it("stops the previous task before scheduling a new one", async () => {
    const first = fakeTask();
    schedule.mockReturnValueOnce(first);
    findUnique.mockResolvedValue({ userId: "u1", enabled: true, cron: "0 3 * * *" });
    await rescheduleUser("u1");

    findUnique.mockResolvedValue({ userId: "u1", enabled: true, cron: "0 4 * * *" });
    await rescheduleUser("u1");

    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it("stops a task and schedules nothing when a config is disabled on reschedule", async () => {
    const first = fakeTask();
    schedule.mockReturnValueOnce(first);
    findUnique.mockResolvedValue({ userId: "u1", enabled: true, cron: "0 3 * * *" });
    await rescheduleUser("u1");

    findUnique.mockResolvedValue({ userId: "u1", enabled: false, cron: "0 3 * * *" });
    await rescheduleUser("u1");

    expect(first.stop).toHaveBeenCalledTimes(1);
    expect(schedule).toHaveBeenCalledTimes(1); // only the first, enabled one
  });
});

describe("startScheduler", () => {
  it("schedules every enabled config and is idempotent", async () => {
    findMany.mockResolvedValue([
      { userId: "u1", enabled: true, cron: "0 3 * * *" },
      { userId: "u2", enabled: true, cron: "0 4 * * *" },
    ]);
    findUnique.mockImplementation(({ where: { userId } }) =>
      Promise.resolve({ userId, enabled: true, cron: "0 3 * * *" }),
    );

    await startScheduler();
    expect(schedule).toHaveBeenCalledTimes(2);

    // Second call is a no-op (already started).
    await startScheduler();
    expect(schedule).toHaveBeenCalledTimes(2);
  });

  it("survives a DB error at startup without throwing", async () => {
    findMany.mockRejectedValue(new Error("db down"));
    await expect(startScheduler()).resolves.toBeUndefined();
    expect(schedule).not.toHaveBeenCalled();
  });
});
