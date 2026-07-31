import { describe, expect, it } from "vitest";
import { getLimitsForYear, KNOWN_LIMIT_YEARS } from "./retirement-limits";

describe("getLimitsForYear", () => {
  it("returns exact limits for a known year without the fallback flag", () => {
    const year = KNOWN_LIMIT_YEARS[0];
    const { limits, isFallback } = getLimitsForYear(year);
    expect(isFallback).toBe(false);
    expect(limits.year).toBe(year);
    expect(limits.electiveDeferral).toBeGreaterThan(0);
  });

  it("falls back to the most recent known year for a future year", () => {
    const latest = Math.max(...KNOWN_LIMIT_YEARS);
    const { limits, isFallback } = getLimitsForYear(latest + 5);
    expect(isFallback).toBe(true);
    expect(limits.year).toBe(latest);
  });

  it("falls back to the earliest known year for a year before the table", () => {
    const earliest = Math.min(...KNOWN_LIMIT_YEARS);
    const { limits, isFallback } = getLimitsForYear(earliest - 5);
    expect(isFallback).toBe(true);
    expect(limits.year).toBe(earliest);
  });

  it("catch-up limits exceed the base limits", () => {
    const { limits } = getLimitsForYear(Math.max(...KNOWN_LIMIT_YEARS));
    expect(limits.electiveDeferralCatchUp).toBeGreaterThan(limits.electiveDeferral);
    expect(limits.iraCatchUp).toBeGreaterThan(limits.iraContribution);
  });

  it("total additions limit exceeds the elective deferral limit", () => {
    const { limits } = getLimitsForYear(Math.max(...KNOWN_LIMIT_YEARS));
    expect(limits.totalAdditions).toBeGreaterThan(limits.electiveDeferral);
  });
});
