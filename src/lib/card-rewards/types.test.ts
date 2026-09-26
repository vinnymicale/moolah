import { describe, it, expect } from "vitest";
import { rewardRulesSchema, rotatingProgramSchema, parseRules, parseRotating } from "./types";

describe("rewardRulesSchema", () => {
  it("accepts rules with and without caps", () => {
    const r = rewardRulesSchema.safeParse([
      { category: "DINING", rate: 3 },
      { category: "GROCERIES", rate: 6, cap: { amount: 6000, period: "YEAR" } },
    ]);
    expect(r.success).toBe(true);
  });

  it("rejects duplicate categories", () => {
    const r = rewardRulesSchema.safeParse([
      { category: "DINING", rate: 3 },
      { category: "DINING", rate: 2 },
    ]);
    expect(r.success).toBe(false);
  });

  it("rejects out-of-range rates, zero caps and unknown categories", () => {
    expect(rewardRulesSchema.safeParse([{ category: "DINING", rate: 101 }]).success).toBe(false);
    expect(rewardRulesSchema.safeParse([{ category: "DINING", rate: -1 }]).success).toBe(false);
    expect(
      rewardRulesSchema.safeParse([{ category: "DINING", rate: 3, cap: { amount: 0, period: "YEAR" } }]).success,
    ).toBe(false);
    expect(rewardRulesSchema.safeParse([{ category: "PETS", rate: 3 }]).success).toBe(false);
  });
});

describe("rotatingProgramSchema", () => {
  const base = {
    rate: 5,
    capAmount: 1500,
    quarters: [{ year: 2026, quarter: 4, categories: ["ONLINE_SHOPPING"] }],
  };

  it("accepts a valid program", () => {
    expect(rotatingProgramSchema.safeParse(base).success).toBe(true);
  });

  it("rejects duplicate quarters, quarter 5 and empty category lists", () => {
    expect(rotatingProgramSchema.safeParse({ ...base, quarters: [...base.quarters, ...base.quarters] }).success).toBe(false);
    expect(
      rotatingProgramSchema.safeParse({ ...base, quarters: [{ year: 2026, quarter: 5, categories: ["GAS"] }] }).success,
    ).toBe(false);
    expect(
      rotatingProgramSchema.safeParse({ ...base, quarters: [{ year: 2026, quarter: 1, categories: [] }] }).success,
    ).toBe(false);
  });
});

describe("parse helpers", () => {
  it("fall back to empty on bad stored JSON", () => {
    expect(parseRules("garbage")).toEqual([]);
    expect(parseRotating({ rate: "x" })).toBeNull();
    expect(parseRotating(null)).toBeNull();
  });

  it("pass valid JSON through", () => {
    expect(parseRules([{ category: "GAS", rate: 3 }])).toEqual([{ category: "GAS", rate: 3 }]);
  });
});
