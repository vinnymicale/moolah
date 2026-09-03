import { describe, it, expect } from "vitest";
import { computeOnboardingSteps, onboardingComplete, type OnboardingInput } from "./onboarding";

const empty: OnboardingInput = { accountCount: 0, transactionCount: 0, budgetCount: 0, recurringCount: 0 };

describe("computeOnboardingSteps", () => {
  it("marks nothing done for a brand new user", () => {
    const steps = computeOnboardingSteps(empty);
    expect(steps.map((s) => s.id)).toEqual(["account", "transactions", "budget", "recurring"]);
    expect(steps.every((s) => !s.done)).toBe(true);
  });

  it("ticks off each step from its own count", () => {
    const steps = computeOnboardingSteps({ ...empty, accountCount: 1, budgetCount: 3 });
    const done = Object.fromEntries(steps.map((s) => [s.id, s.done]));
    expect(done).toEqual({ account: true, transactions: false, budget: true, recurring: false });
  });

  it("gives every step a destination and a label", () => {
    for (const step of computeOnboardingSteps(empty)) {
      expect(step.href.startsWith("/")).toBe(true);
      expect(step.cta.length).toBeGreaterThan(0);
      expect(step.detail.length).toBeGreaterThan(0);
    }
  });

  it("keeps steps in dependency order", () => {
    // Transactions need an account, budgets are measured against transactions.
    const ids = computeOnboardingSteps(empty).map((s) => s.id);
    expect(ids.indexOf("account")).toBeLessThan(ids.indexOf("transactions"));
    expect(ids.indexOf("transactions")).toBeLessThan(ids.indexOf("budget"));
  });
});

describe("onboardingComplete", () => {
  it("is false while any step is outstanding", () => {
    expect(onboardingComplete(computeOnboardingSteps(empty))).toBe(false);
    expect(
      onboardingComplete(
        computeOnboardingSteps({ accountCount: 2, transactionCount: 40, budgetCount: 5, recurringCount: 0 }),
      ),
    ).toBe(false);
  });

  it("is true once all four are satisfied", () => {
    expect(
      onboardingComplete(
        computeOnboardingSteps({ accountCount: 1, transactionCount: 1, budgetCount: 1, recurringCount: 1 }),
      ),
    ).toBe(true);
  });
});
