import { test, expect } from "@playwright/test";

test.describe("dashboard", () => {
  test("loads with demo data and the demo banner", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Moolah/);
    await expect(page.getByText("Demo User")).toBeVisible();
    await expect(page.getByText("Demo mode", { exact: true })).toBeVisible();
    await expect(page.getByText("Changes are local only and reset on refresh.")).toBeVisible();
  });

  test("sidebar has the GitHub repo link", async ({ page }) => {
    await page.goto("/");
    const link = page.getByTitle("View source on GitHub");
    await expect(link).toBeVisible();
    await expect(link).toHaveAttribute("href", /github\.com/);
  });
});

test.describe("navigation", () => {
  for (const { path, marker } of [
    { path: "/transactions", marker: "Paycheck" },
    { path: "/calendar", marker: "Netflix" },
    { path: "/budgets", marker: "Budgets" },
    { path: "/accounts", marker: "Accounts" },
    { path: "/recurring", marker: "Recurring" },
    { path: "/trends", marker: "Trends" },
    { path: "/debt", marker: "Debt" },
    { path: "/goals", marker: "Goals" },
    { path: "/categories", marker: "Groceries" },
  ]) {
    test(`${path} renders demo content`, async ({ page }) => {
      await page.goto(path);
      await expect(page.getByText(marker).first()).toBeVisible();
    });
  }
});

test.describe("chrome interactions", () => {
  test("command palette opens with the keyboard shortcut", async ({ page }) => {
    await page.goto("/");
    await page.keyboard.press("ControlOrMeta+k");
    await expect(page.getByPlaceholder(/Search all transactions/)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByPlaceholder(/Search all transactions/)).not.toBeVisible();
  });

  test("theme toggle flips dark mode", async ({ page }) => {
    await page.goto("/");
    const wasDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await expect
      .poll(() => page.evaluate(() => document.documentElement.classList.contains("dark")))
      .toBe(!wasDark);
  });

  test("keyboard shortcuts modal opens from the sidebar", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Keyboard shortcuts" }).click();
    await expect(page.getByRole("dialog", { name: "Keyboard shortcuts" })).toBeVisible();
  });
});

test.describe("demo-mode guards", () => {
  test("sign-in redirects to the dashboard", async ({ page }) => {
    await page.goto("/signin");
    await expect(page).toHaveURL(/\/$/);
  });

  test("sensitive API routes are blocked", async ({ request }) => {
    for (const path of ["/api/chat", "/api/backup", "/api/export/transactions", "/api/plaid/link-token"]) {
      const res = await request.post(path, { failOnStatusCode: false, data: {} });
      expect(res.status(), `${path} should be blocked`).toBe(403);
    }
  });
});

test.describe("transaction modal", () => {
  test("opens from the sidebar and accepts a local-only entry", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Add transaction" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();
  });
});
