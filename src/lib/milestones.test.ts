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
