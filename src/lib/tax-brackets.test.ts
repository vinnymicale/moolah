import { describe, it, expect } from "vitest";
import { getTaxTableForYear, marginalRate, deferralSavings, KNOWN_TAX_YEARS } from "./tax-brackets";

describe("getTaxTableForYear", () => {
  it("returns the exact year when known", () => {
    expect(getTaxTableForYear(2026)).toMatchObject({ table: { year: 2026 }, isFallback: false });
  });

  it("clamps unknown years to the nearest known one", () => {
    expect(getTaxTableForYear(2020)).toMatchObject({ table: { year: 2025 }, isFallback: true });
    expect(getTaxTableForYear(2099)).toMatchObject({ table: { year: 2026 }, isFallback: true });
  });

  it("keeps brackets ascending with no gaps in rate order", () => {
    for (const year of KNOWN_TAX_YEARS) {
      const { table } = getTaxTableForYear(year);
      for (const brackets of Object.values(table.brackets)) {
        expect(brackets[0].from).toBe(0);
        for (let i = 1; i < brackets.length; i++) {
          expect(brackets[i].from).toBeGreaterThan(brackets[i - 1].from);
          expect(brackets[i].rate).toBeGreaterThan(brackets[i - 1].rate);
        }
      }
    }
  });
});

describe("marginalRate", () => {
  it("applies the standard deduction before bracketing", () => {
    // 2026 single: 16,100 deduction, 22% starts at 50,400 taxable.
    expect(marginalRate({ grossIncome: 66_000, filingStatus: "SINGLE", year: 2026 }).rate).toBe(12);
    expect(marginalRate({ grossIncome: 67_000, filingStatus: "SINGLE", year: 2026 }).rate).toBe(22);
  });

  it("uses the joint table for married filers", () => {
    // 133,000 gross - 32,200 = 100,800 taxable, exactly the 22% floor.
    expect(marginalRate({ grossIncome: 133_000, filingStatus: "MARRIED_JOINT", year: 2026 }).rate).toBe(22);
    expect(marginalRate({ grossIncome: 132_000, filingStatus: "MARRIED_JOINT", year: 2026 }).rate).toBe(12);
  });

  it("floors at the bottom bracket when income is under the deduction", () => {
    const r = marginalRate({ grossIncome: 5_000, filingStatus: "SINGLE", year: 2026 });
    expect(r.rate).toBe(10);
    expect(r.taxableIncome).toBe(0);
  });

  it("reaches the top bracket", () => {
    expect(marginalRate({ grossIncome: 900_000, filingStatus: "SINGLE", year: 2026 }).rate).toBe(37);
  });
});

describe("deferralSavings", () => {
  it("reports a flat rate when the deferral stays inside one bracket", () => {
    const r = deferralSavings({ grossIncome: 140_000, amount: 5_000, filingStatus: "SINGLE", year: 2026 });
    expect(r.topRate).toBe(24);
    expect(r.effectiveRate).toBe(24);
    expect(r.crossesBracket).toBe(false);
  });

  it("blends the rate when the deferral crosses a bracket edge", () => {
    // 2026 single, 70,000 gross -> 53,900 taxable. 22% floor is 50,400, so the
    // first 3,500 deferred saves at 22% and the next 6,500 at 12%.
    const r = deferralSavings({ grossIncome: 70_000, amount: 10_000, filingStatus: "SINGLE", year: 2026 });
    expect(r.topRate).toBe(22);
    expect(r.crossesBracket).toBe(true);
    const expected = ((3_500 * 0.22 + 6_500 * 0.12) / 10_000) * 100;
    expect(r.effectiveRate).toBeCloseTo(expected, 6);
    expect(r.effectiveRate).toBeLessThan(22);
    expect(r.effectiveRate).toBeGreaterThan(12);
  });

  it("treats a zero deferral as the plain marginal rate", () => {
    const r = deferralSavings({ grossIncome: 140_000, amount: 0, filingStatus: "SINGLE", year: 2026 });
    expect(r.effectiveRate).toBe(24);
    expect(r.crossesBracket).toBe(false);
  });

  it("never reports an effective rate above the top rate", () => {
    for (const gross of [30_000, 70_000, 150_000, 300_000, 800_000]) {
      const r = deferralSavings({ grossIncome: gross, amount: 20_000, filingStatus: "SINGLE", year: 2026 });
      expect(r.effectiveRate).toBeLessThanOrEqual(r.topRate);
    }
  });
});
