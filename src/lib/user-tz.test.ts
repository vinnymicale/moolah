import { describe, it, expect, vi, afterEach } from "vitest";
import { todayInZone } from "./user-tz";

afterEach(() => {
  vi.useRealTimers();
});

describe("todayInZone", () => {
  it("returns YYYY-MM-DD for a valid zone", () => {
    expect(todayInZone("America/New_York")).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("disagrees with UTC across the date line (the bug this fixes)", () => {
    // 2 AM UTC on June 10 is still June 9 in New York.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T02:00:00Z"));
    expect(todayInZone("UTC")).toBe("2026-06-10");
    expect(todayInZone("America/New_York")).toBe("2026-06-09");
    expect(todayInZone("Asia/Tokyo")).toBe("2026-06-10");
  });

  it("falls back to UTC for missing or invalid zones", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T02:00:00Z"));
    expect(todayInZone(undefined)).toBe("2026-06-10");
    expect(todayInZone("Not/AZone")).toBe("2026-06-10");
  });
});
