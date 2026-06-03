import { describe, expect, it } from "vitest";
import { simulatePayoff, monthsToLabel, type DebtInput } from "./debt-payoff";

const cc = (over: Partial<DebtInput> = {}): DebtInput => ({
  id: "cc", name: "Card", color: "#000", balance: 1000, apr: 20, minPayment: 50, ...over,
});

describe("simulatePayoff", () => {
  it("pays off a single debt and reports a positive month count", () => {
    const plan = simulatePayoff([cc()], "avalanche", 0);
    expect(plan.feasible).toBe(true);
    expect(plan.totalMonths).toBeGreaterThan(0);
    expect(plan.perDebt[0].monthsToPayoff).toBe(plan.totalMonths);
    // Balance line ends at (near) zero.
    expect(plan.months.at(-1)!.totalBalance).toBeLessThan(0.01);
  });

  it("extra payments shorten payoff and reduce total interest", () => {
    const base = simulatePayoff([cc()], "avalanche", 0);
    const fast = simulatePayoff([cc()], "avalanche", 200);
    expect(fast.totalMonths).toBeLessThan(base.totalMonths);
    expect(fast.totalInterest).toBeLessThan(base.totalInterest);
  });

  it("flags an infeasible plan when payments can't cover interest", () => {
    // 1% min on a huge balance at high APR never amortises.
    const plan = simulatePayoff([cc({ balance: 100_000, apr: 30, minPayment: 10 })], "avalanche", 0);
    expect(plan.feasible).toBe(false);
    expect(plan.reason).toBeTruthy();
  });

  it("avalanche targets the highest APR first", () => {
    const high = cc({ id: "high", name: "High", balance: 1000, apr: 25, minPayment: 25 });
    const low = cc({ id: "low", name: "Low", balance: 1000, apr: 5, minPayment: 25 });
    const plan = simulatePayoff([low, high], "avalanche", 200);
    const highRes = plan.perDebt.find((d) => d.id === "high")!;
    const lowRes = plan.perDebt.find((d) => d.id === "low")!;
    expect(highRes.monthsToPayoff).toBeLessThanOrEqual(lowRes.monthsToPayoff);
  });

  it("snowball targets the smallest balance first", () => {
    const small = cc({ id: "small", name: "Small", balance: 500, apr: 10, minPayment: 25 });
    const big = cc({ id: "big", name: "Big", balance: 5000, apr: 10, minPayment: 25 });
    const plan = simulatePayoff([big, small], "snowball", 200);
    const smallRes = plan.perDebt.find((d) => d.id === "small")!;
    const bigRes = plan.perDebt.find((d) => d.id === "big")!;
    expect(smallRes.monthsToPayoff).toBeLessThan(bigRes.monthsToPayoff);
  });

  it("returns an empty plan for no debts", () => {
    const plan = simulatePayoff([], "avalanche", 0);
    expect(plan.feasible).toBe(true);
    expect(plan.totalMonths).toBe(0);
  });
});

describe("monthsToLabel", () => {
  it("formats months into years and months", () => {
    expect(monthsToLabel(0)).toBe("Paid off");
    expect(monthsToLabel(5)).toBe("5 mo");
    expect(monthsToLabel(12)).toBe("1 yr");
    expect(monthsToLabel(27)).toBe("2 yr 3 mo");
  });
});
