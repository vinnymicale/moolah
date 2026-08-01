import { test, expect } from "@playwright/test";

// Coverage notes:
//
// The brief for this task lists five scenarios: the wizard appearing for a user
// with accounts but no plan, completing the wizard, the populated page, recording
// a contribution, and the empty state for a user with no retirement accounts.
//
// This harness runs against a production build with DEMO_MODE=true and
// AUTH_BYPASS=true, reading a fixed seeded database (see playwright.config.ts).
// In demo mode every retirement server action in src/actions/retirement.ts
// early-returns { ok: true } without writing, and the seed script always creates
// a completed RetirementPlan plus two retirement accounts for the single demo
// user. That means:
//
// - The no-plan wizard and the "finish setup" flow cannot be reached: the demo
//   user always has a completed plan.
// - Recording a contribution cannot be observed: createContributionAction
//   returns ok without persisting, so nothing new appears in the recent list.
// - The empty state cannot be reached: the demo user always has retirement
//   accounts, and this harness has exactly one user.
//
// Those three paths are covered by unit tests in src/actions/retirement.test.ts
// instead. This spec covers what the demo harness genuinely exercises: the
// populated retirement page and the net worth growth toggle.

test.describe("retirement page", () => {
  test("renders the populated page, not the wizard or empty state", async ({ page }) => {
    await page.goto("/retirement");
    await expect(page.getByRole("heading", { name: "Retirement" })).toBeVisible();
    await expect(page.getByText("No retirement or investment accounts yet")).not.toBeVisible();
    await expect(page.getByRole("button", { name: /finish setup/i })).not.toBeVisible();
  });

  test("shows the verdict header", async ({ page }) => {
    await page.goto("/retirement");
    await expect(page.getByText(/on track|behind by/i)).toBeVisible();
  });

  test("shows all four stat cards", async ({ page }) => {
    await page.goto("/retirement");
    await expect(page.getByText("Retirement balance")).toBeVisible();
    await expect(page.getByText(/^Projected at \d+$/)).toBeVisible();
    await expect(page.getByText("Target", { exact: true })).toBeVisible();
    await expect(page.getByText("Monthly contribution")).toBeVisible();
  });

  test("renders the projection chart with the projection and Coast FIRE lines", async ({ page }) => {
    await page.goto("/retirement");
    await expect(page.getByText("Projected balance")).toBeVisible();
    await expect(page.locator(".recharts-legend-item").filter({ hasText: "Projected" })).toBeVisible();
    await expect(page.locator(".recharts-legend-item").filter({ hasText: "Coast FIRE" })).toBeVisible();
    await expect(page.locator(".recharts-line")).toHaveCount(2);
  });

  test("renders the remaining panels", async ({ page }) => {
    await page.goto("/retirement");
    await expect(page.getByText(/^Contribution limits/)).toBeVisible();
    await expect(page.getByText("Growth, last 12 months")).toBeVisible();
    await expect(page.getByText("Drawdown scenarios")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Contributions" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Assumptions" })).toBeVisible();
  });
});

test.describe("net worth growth toggle", () => {
  test("toggling investment growth on renders the stacked growth band", async ({ page }) => {
    await page.goto("/networth");
    const toggle = page.getByLabel("Show investment growth");
    await expect(toggle).toBeVisible();
    await expect(toggle).not.toBeChecked();
    await toggle.check();
    await expect(toggle).toBeChecked();
    await expect(page.locator(".recharts-legend-item").filter({ hasText: "Contributed" })).toBeVisible();
    await expect(page.locator(".recharts-legend-item").filter({ hasText: "Market gains" })).toBeVisible();
  });
});
