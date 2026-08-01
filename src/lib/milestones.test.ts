import { describe, it, expect } from "vitest";
import { computeMilestones } from "./milestones";
import type { SavingsGoalDTO } from "./queries";

function goal(over: Partial<SavingsGoalDTO>): SavingsGoalDTO {
  return {
    id: "g1", name: "Emergency fund", targetAmount: 10000, currentAmount: 0,
    targetDate: null, color: "#000", icon: "piggy-bank", archived: false,
    ...over,
  };
}

const base = { netWorth: 0, goals: [], savingsRate: null, net: 0 };

describe("computeMilestones", () => {
  it("picks the highest crossed net-worth tier only", () => {
    const out = computeMilestones({ ...base, netWorth: 120_000 });
    expect(out).toHaveLength(1);
    expect(out[0].id).toBe("nw-100000");
    expect(out[0].title).toContain("$100k");
  });

  it("emits nothing below the first tier or for zero net worth", () => {
    expect(computeMilestones({ ...base, netWorth: 999 })).toEqual([]);
  });

  it("celebrates fully-funded goals, ignoring zero-target goals", () => {
    const out = computeMilestones({
      ...base,
      goals: [
        goal({ id: "done", currentAmount: 10000 }),
        goal({ id: "partial", currentAmount: 500 }),
        goal({ id: "zero", targetAmount: 0, currentAmount: 0 }),
      ],
    });
    expect(out.map((m) => m.id)).toEqual(["goal-done"]);
  });

  it("celebrates a strong savings rate only with positive net", () => {
    expect(computeMilestones({ ...base, savingsRate: 35, net: 100 })).toHaveLength(1);
    expect(computeMilestones({ ...base, savingsRate: 35, net: -100 })).toEqual([]);
    expect(computeMilestones({ ...base, savingsRate: 10, net: 100 })).toEqual([]);
  });

  it("buckets savings ids by threshold so dismissals stick per level", () => {
    const m35 = computeMilestones({ ...base, savingsRate: 35, net: 1 })[0];
    const m55 = computeMilestones({ ...base, savingsRate: 55, net: 1 })[0];
    expect(m35.id.endsWith("-30")).toBe(true);
    expect(m55.id.endsWith("-50")).toBe(true);
  });
});

describe("retirement milestones", () => {
  const retirement = (over: Partial<Parameters<typeof computeMilestones>[0]["retirement"] & object> = {}) => ({
    balance: 0,
    annualSalary: 100_000,
    age: 35,
    coastFireReached: false,
    matchForfeited: 0,
    ...over,
  });

  const args = (retirementOver = {}) => ({
    netWorth: 0,
    goals: [],
    savingsRate: null,
    net: 0,
    retirement: retirement(retirementOver),
  });

  it("celebrates the highest retirement balance tier crossed", () => {
    const found = computeMilestones(args({ balance: 120_000 })).filter((m) => m.kind === "retirement");
    expect(found.some((m) => m.id === "retire-balance-100000")).toBe(true);
    expect(found.some((m) => m.id === "retire-balance-50000")).toBe(false);
  });

  it("celebrates a salary multiple once reached", () => {
    const found = computeMilestones(args({ balance: 100_000, annualSalary: 100_000, age: 31 }));
    expect(found.some((m) => m.id === "retire-multiple-1")).toBe(true);
  });

  it("does not award a salary multiple that has not been reached", () => {
    const found = computeMilestones(args({ balance: 50_000, annualSalary: 100_000 }));
    expect(found.some((m) => m.id.startsWith("retire-multiple-"))).toBe(false);
  });

  it("celebrates reaching Coast FIRE", () => {
    const found = computeMilestones(args({ coastFireReached: true }));
    expect(found.some((m) => m.id === "retire-coast-fire")).toBe(true);
  });

  it("celebrates capturing the full employer match", () => {
    const found = computeMilestones(args({ matchForfeited: 0, balance: 1 }));
    expect(found.some((m) => m.id.startsWith("retire-full-match-"))).toBe(true);
  });

  it("does not celebrate a full match when money was left on the table", () => {
    const found = computeMilestones(args({ matchForfeited: 500, balance: 1 }));
    expect(found.some((m) => m.id.startsWith("retire-full-match-"))).toBe(false);
  });

  it("emits no retirement milestones when the argument is omitted", () => {
    const found = computeMilestones({ netWorth: 0, goals: [], savingsRate: null, net: 0 });
    expect(found.some((m) => m.kind === "retirement")).toBe(false);
  });
});
