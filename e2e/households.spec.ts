import { test, expect, type Page } from "@playwright/test";

// Runs against the non-demo server (see playwright.config.ts): real sign-in,
// writes allowed. The admin is the seeded owner; the member is created by this
// test through the UI, which is the flow under test.
//
// Serial, because both tests share one household and the second reads the audit
// entries the first one writes.
test.describe.configure({ mode: "serial" });

const ADMIN_NAME = "Demo User";
const ADMIN_PASSWORD = "demodemo123";

const MEMBER_NAME = `E2E Member ${Date.now()}`;
const MEMBER_TEMP_PASSWORD = "temp-password-1";
const MEMBER_NEW_PASSWORD = "member-password-2";

async function signIn(page: Page, name: string, password: string) {
  await page.goto("/signin");
  await page.getByPlaceholder("Your name").fill(name);
  await page.getByPlaceholder("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The form signs in with redirect:false and then sets window.location itself,
  // so the click resolves well before the app is actually reachable. Without
  // this wait the next goto() races the redirect and lands back on sign-in.
  await page.waitForURL((url) => !url.pathname.startsWith("/signin"));
}

test("an admin adds a member and denies them a page", async ({ page, browser }) => {
  await signIn(page, ADMIN_NAME, ADMIN_PASSWORD);
  await page.goto("/settings");
  const main = page.locator("main");
  await expect(main.getByText("Household members")).toBeVisible();

  // 1. Add the member with a temporary password.
  await main.getByRole("button", { name: "New member" }).click();
  await main.getByPlaceholder("Name").fill(MEMBER_NAME);
  await main.getByPlaceholder("Temporary password").fill(MEMBER_TEMP_PASSWORD);
  await main.getByRole("button", { name: "Add member" }).click();

  // The name also turns up in the audit log below, so match the member row by
  // the control only a row has rather than by the name alone.
  const row = main.locator("li").filter({ has: page.getByTitle("Permissions") }).filter({ hasText: MEMBER_NAME });
  await expect(row).toBeVisible();

  // 2. Block their view of budgets and their use of the assistant. A member gets
  // the assistant by default, so blocking it proves the override, not the role.
  await row.getByTitle("Permissions").click();
  const budgets = row.locator("li").filter({ hasText: "View budgets" });
  await budgets.getByRole("button", { name: "Block" }).click();
  const chat = row.locator("li").filter({ hasText: "Use the finance assistant" });
  await chat.getByRole("button", { name: "Block" }).click();
  await main.getByRole("button", { name: "Save permissions" }).click();
  await expect(main.getByText("Saved.")).toBeVisible();

  // 3. A separate browser context is the whole point: two people signed in at
  // once on one server, each with their own session and permissions.
  const memberContext = await browser.newContext();
  const memberPage = await memberContext.newPage();
  await signIn(memberPage, MEMBER_NAME, MEMBER_TEMP_PASSWORD);

  // An admin-created account can't reach the app on the password its admin chose.
  await expect(memberPage).toHaveURL(/\/change-password/);
  await memberPage.getByPlaceholder("Temporary password").fill(MEMBER_TEMP_PASSWORD);
  await memberPage.getByPlaceholder("New password", { exact: true }).fill(MEMBER_NEW_PASSWORD);
  await memberPage.getByPlaceholder("Confirm new password").fill(MEMBER_NEW_PASSWORD);
  await memberPage.getByRole("button", { name: "Save password" }).click();
  await expect(memberPage).not.toHaveURL(/\/change-password/);

  // 4. The denied page is gone from the nav and unreachable by URL.
  const memberNav = memberPage.locator("nav");
  await expect(memberNav.getByRole("link", { name: "Budgets" })).toHaveCount(0);
  await memberPage.goto("/budgets");
  await expect(memberPage).toHaveURL(/localhost:3101\/$/);

  // 5. No way into the assistant - the route would 403 anyway, so the button
  // going missing is the point.
  await expect(memberPage.getByRole("button", { name: "Open finance assistant" })).toHaveCount(0);

  // 6. What they still have works.
  await expect(memberNav.getByRole("link", { name: "Transactions" })).toBeVisible();
  await memberPage.goto("/transactions");
  await expect(memberPage).toHaveURL(/\/transactions/);
  await expect(memberPage.locator("main")).toBeVisible();

  // 7. The admin's own session survived all of that untouched.
  await page.goto("/settings");
  await expect(main.getByText("Household members")).toBeVisible();
  const activity = main.locator("li").filter({ hasText: MEMBER_NAME }).filter({ hasText: "member." });
  await expect(activity.filter({ hasText: "member.add" })).toHaveCount(1);
  await expect(activity.filter({ hasText: "member.capabilities" })).toHaveCount(1);

  await memberContext.close();
});

test("a member cannot reach settings", async ({ page }) => {
  await signIn(page, MEMBER_NAME, MEMBER_NEW_PASSWORD);
  await page.goto("/settings");
  await expect(page).toHaveURL(/\/no-access/);
});
