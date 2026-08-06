import { test, expect } from "@playwright/test";

// The amortization panel on /debt. This harness runs against a production build
// with DEMO_MODE=true, whose fixed account set (src/lib/demo-data.ts) includes a
// single qualifying installment loan - the Auto Loan, $18,420.55 at 5.4% over 60
// months. Credit cards are excluded from the panel by design, so that one loan
// is what renders here, and the loan picker stays a static label rather than a
// select. Everything below is derived from those seeded terms.

test.describe("amortization panel", () => {
  test("renders the schedule for the demo loan", async ({ page }) => {
    await page.goto("/debt");

    const panel = page.locator("section", { has: page.getByRole("heading", { name: "Amortization" }) });
    await expect(panel).toBeVisible();

    // One qualifying loan means a static label, not a picker.
    await expect(panel.getByText("Auto Loan")).toBeVisible();
    await expect(panel.getByText(/\$18,420\.55 at 5\.4%/)).toBeVisible();

    await expect(panel.getByText("Paid off in")).toBeVisible();
    await expect(panel.getByText("Remaining interest")).toBeVisible();
    await expect(panel.getByText("Saved by overpaying")).toBeVisible();

    // Nothing should render the NaN/null artifacts a bad schedule used to emit.
    await expect(panel).not.toContainText("NaN");
    await expect(panel).not.toContainText("$0.00/mo");
  });

  test("an extra payment shortens the term and reports the saving", async ({ page }) => {
    await page.goto("/debt");
    const panel = page.locator("section", { has: page.getByRole("heading", { name: "Amortization" }) });

    const paidOff = panel.locator("div").filter({ hasText: /^Paid off in/ }).first();
    const before = await paidOff.innerText();

    // With no extra, there is nothing to have saved.
    await expect(panel.getByText("Add an extra payment to save")).toBeVisible();

    await panel.getByRole("textbox").fill("300");

    await expect(paidOff).not.toHaveText(before);
    await expect(panel.getByText(/sooner$/)).toBeVisible();
  });

  test("the yearly schedule table expands on demand", async ({ page }) => {
    await page.goto("/debt");
    const panel = page.locator("section", { has: page.getByRole("heading", { name: "Amortization" }) });

    await expect(panel.getByRole("table")).toBeHidden();
    await panel.getByRole("button", { name: /Yearly schedule/ }).click();

    const table = panel.getByRole("table");
    await expect(table).toBeVisible();
    await expect(table.getByRole("columnheader", { name: "Principal" })).toBeVisible();
    // The loan is partly paid down, so it clears in 45 months - four yearly rows.
    await expect(table.locator("tbody tr")).toHaveCount(4);
    // The loan is fully retired by the final row.
    await expect(table.locator("tbody tr").last()).toContainText("$0.00");
  });
});
