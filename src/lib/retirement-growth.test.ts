import { describe, expect, it } from "vitest";
import { attributeGrowth } from "./retirement-growth";
import type { ContributionRecord, ScheduledContribution } from "./retirement-types";

const START = new Date("2026-01-01T00:00:00.000Z");
const END = new Date("2026-04-01T00:00:00.000Z");

const contrib = (dateISO: string, amount = 1_000): ContributionRecord => ({
  financialAccountId: "a1",
  date: new Date(`${dateISO}T00:00:00.000Z`),
  amount,
  source: "EMPLOYEE_PRETAX",
});

const monthlySchedule: ScheduledContribution = {
  financialAccountId: "a1",
  amount: 1_000,
  source: "EMPLOYEE_PRETAX",
  frequency: "MONTHLY",
  interval: 1,
  startDate: new Date("2020-01-01T00:00:00.000Z"),
  endDate: null,
  dayOfMonth: 1,
  weekday: null,
};

describe("attributeGrowth", () => {
  it("splits the balance delta into contributions and market return", () => {
    const r = attributeGrowth({
      startBalance: 100_000,
      endBalance: 108_000,
      contributions: [contrib("2026-01-01"), contrib("2026-02-01"), contrib("2026-03-01")],
      schedules: [monthlySchedule],
      startDate: START,
      endDate: END,
    });
    expect(r.balanceDelta).toBe(8_000);
    expect(r.contributed).toBe(3_000);
    expect(r.marketReturn).toBe(5_000);
  });

  it("reports a negative market return when the balance falls", () => {
    const r = attributeGrowth({
      startBalance: 100_000,
      endBalance: 99_000,
      contributions: [contrib("2026-01-01")],
      schedules: [],
      startDate: START,
      endDate: END,
    });
    expect(r.marketReturn).toBe(-2_000);
  });

  it("expresses market return as a percentage of the starting balance", () => {
    const r = attributeGrowth({
      startBalance: 100_000,
      endBalance: 105_000,
      contributions: [],
      schedules: [],
      startDate: START,
      endDate: END,
    });
    expect(r.marketReturnPercent).toBeCloseTo(5, 6);
  });

  it("returns a null percentage when the starting balance is zero", () => {
    const r = attributeGrowth({
      startBalance: 0,
      endBalance: 5_000,
      contributions: [contrib("2026-01-01", 5_000)],
      schedules: [],
      startDate: START,
      endDate: END,
    });
    expect(r.marketReturnPercent).toBeNull();
  });

  it("is confident when every scheduled month has a recorded contribution", () => {
    const r = attributeGrowth({
      startBalance: 100_000,
      endBalance: 108_000,
      contributions: [contrib("2026-01-01"), contrib("2026-02-01"), contrib("2026-03-01")],
      schedules: [monthlySchedule],
      startDate: START,
      endDate: END,
    });
    expect(r.confident).toBe(true);
    expect(r.gapMonths).toEqual([]);
  });

  it("names months that expected a contribution but recorded none", () => {
    const r = attributeGrowth({
      startBalance: 100_000,
      endBalance: 108_000,
      contributions: [contrib("2026-01-01")],
      schedules: [monthlySchedule],
      startDate: START,
      endDate: END,
    });
    expect(r.confident).toBe(false);
    expect(r.gapMonths).toEqual(["2026-02", "2026-03"]);
  });

  it("is confident when there are no schedules to reconcile against", () => {
    const r = attributeGrowth({
      startBalance: 100_000,
      endBalance: 108_000,
      contributions: [],
      schedules: [],
      startDate: START,
      endDate: END,
    });
    expect(r.confident).toBe(true);
    expect(r.gapMonths).toEqual([]);
  });

  it("ignores contributions outside the period", () => {
    const r = attributeGrowth({
      startBalance: 100_000,
      endBalance: 108_000,
      contributions: [contrib("2025-12-01"), contrib("2026-02-01")],
      schedules: [],
      startDate: START,
      endDate: END,
    });
    expect(r.contributed).toBe(1_000);
  });

  // Boundary: a schedule occurrence landing exactly on endDate is excluded from
  // the expected-months set, matching the half-open contribution filter
  // (c.date >= startDate && c.date < endDate). Without this, a contribution
  // recorded on endDate would count toward `contributed` but not satisfy the
  // expected month, producing a phantom gap and a spurious confident: false.
  it("does not report a gap for a schedule occurrence exactly on endDate", () => {
    const endBoundarySchedule: ScheduledContribution = {
      ...monthlySchedule,
      dayOfMonth: 1, // occurrence lands on 2026-04-01, i.e. END
    };
    const r = attributeGrowth({
      startBalance: 100_000,
      endBalance: 103_000,
      contributions: [
        contrib("2026-01-01"),
        contrib("2026-02-01"),
        contrib("2026-03-01"),
        contrib("2026-04-01"),
      ],
      schedules: [endBoundarySchedule],
      startDate: START,
      endDate: END,
    });
    expect(r.gapMonths).toEqual([]);
    expect(r.confident).toBe(true);
  });

  // Symmetric boundary: startDate is inclusive on both the occurrence expansion
  // and the contribution filter, so a schedule occurrence and a recorded
  // contribution both landing exactly on startDate should already agree.
  it("does not report a gap for a schedule occurrence exactly on startDate", () => {
    const r = attributeGrowth({
      startBalance: 100_000,
      endBalance: 103_000,
      contributions: [contrib("2026-01-01"), contrib("2026-02-01"), contrib("2026-03-01")],
      schedules: [monthlySchedule],
      startDate: START,
      endDate: END,
    });
    expect(r.gapMonths).toEqual([]);
    expect(r.confident).toBe(true);
  });
});
