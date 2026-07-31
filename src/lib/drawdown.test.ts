import { describe, expect, it } from "vitest";
import { modelDrawdown } from "./drawdown";

const base = { nestEgg: 1_000_000, annualWithdrawal: 40_000, realAnnualReturn: 4 };

describe("modelDrawdown", () => {
  it("returns three scenarios plus a stress case", () => {
    const r = modelDrawdown(base);
    expect(r.scenarios).toHaveLength(3);
    expect(r.stressCase).toBeDefined();
  });

  it("orders scenarios from pessimistic to optimistic", () => {
    const r = modelDrawdown(base);
    expect(r.scenarios[0].realAnnualReturn).toBeLessThan(r.scenarios[1].realAnnualReturn);
    expect(r.scenarios[1].realAnnualReturn).toBeLessThan(r.scenarios[2].realAnnualReturn);
  });

  it("lasts longer with a higher return", () => {
    const r = modelDrawdown(base);
    expect(r.scenarios[2].yearsLasted).toBeGreaterThanOrEqual(r.scenarios[0].yearsLasted);
  });

  it("never depletes when returns cover the withdrawal", () => {
    // 4% withdrawal against a 4% real return sustains indefinitely.
    const r = modelDrawdown({ nestEgg: 1_000_000, annualWithdrawal: 40_000, realAnnualReturn: 4 });
    expect(r.scenarios[2].depleted).toBe(false);
  });

  it("depletes quickly when withdrawals dwarf returns", () => {
    const r = modelDrawdown({ nestEgg: 100_000, annualWithdrawal: 50_000, realAnnualReturn: 0 });
    expect(r.scenarios[1].depleted).toBe(true);
    expect(r.scenarios[1].yearsLasted).toBeLessThanOrEqual(3);
  });

  it("depletes immediately when the nest egg is zero", () => {
    const r = modelDrawdown({ ...base, nestEgg: 0 });
    expect(r.scenarios[1].yearsLasted).toBe(0);
    expect(r.scenarios[1].depleted).toBe(true);
  });

  it("never depletes when withdrawals are zero", () => {
    const r = modelDrawdown({ ...base, annualWithdrawal: 0 });
    expect(r.scenarios[1].depleted).toBe(false);
  });

  it("stress case depletes sooner than the base case at the same average return", () => {
    const r = modelDrawdown({ nestEgg: 800_000, annualWithdrawal: 45_000, realAnnualReturn: 4 });
    expect(r.stressCase.yearsLasted).toBeLessThanOrEqual(r.scenarios[1].yearsLasted);
  });

  it("caps reported longevity at maxYears", () => {
    const r = modelDrawdown({ ...base, annualWithdrawal: 0, maxYears: 30 });
    expect(r.scenarios[1].yearsLasted).toBe(30);
  });
});
