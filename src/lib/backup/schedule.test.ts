import { describe, it, expect } from "vitest";
import { cronFor, scheduleFromCron, isValidSchedule } from "./schedule";

describe("cronFor", () => {
  it("builds a daily cron at the given hour", () => {
    expect(cronFor({ frequency: "daily", hour: 3 })).toBe("0 3 * * *");
    expect(cronFor({ frequency: "daily", hour: 0 })).toBe("0 0 * * *");
  });

  it("builds a weekly cron at the given weekday and hour", () => {
    expect(cronFor({ frequency: "weekly", hour: 14, weekday: 1 })).toBe("0 14 * * 1");
  });
});

describe("scheduleFromCron", () => {
  it("round-trips our own presets", () => {
    expect(scheduleFromCron("0 3 * * *")).toEqual({ frequency: "daily", hour: 3 });
    expect(scheduleFromCron("0 14 * * 1")).toEqual({ frequency: "weekly", hour: 14, weekday: 1 });
  });

  it("falls back to a daily default for anything it can't parse", () => {
    expect(scheduleFromCron("*/15 * * * *")).toEqual({ frequency: "daily", hour: 3 });
    expect(scheduleFromCron("garbage")).toEqual({ frequency: "daily", hour: 3 });
  });
});

describe("isValidSchedule", () => {
  it("accepts valid daily and weekly schedules", () => {
    expect(isValidSchedule({ frequency: "daily", hour: 0 })).toBe(true);
    expect(isValidSchedule({ frequency: "weekly", hour: 23, weekday: 6 })).toBe(true);
  });

  it("rejects out-of-range hours and weekdays", () => {
    expect(isValidSchedule({ frequency: "daily", hour: 24 })).toBe(false);
    expect(isValidSchedule({ frequency: "weekly", hour: 3, weekday: 7 })).toBe(false);
    expect(isValidSchedule({ frequency: "weekly", hour: 3 })).toBe(false);
  });
});
