// Recapture the README screenshots against the demo build.
//
// Run a demo-mode server first (DEMO_MODE=true AUTH_BYPASS=true npm start) with
// the demo data seeded, then: `tsx scripts/screenshots.ts`. Writes PNGs into
// docs/screenshots/ using the same names the README references.

import { chromium, type Page } from "playwright";
import path from "node:path";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "docs", "screenshots");
const VIEWPORT = { width: 1440, height: 900 };

async function dismissWelcome(page: Page) {
  const dialog = page.getByRole("dialog", { name: "Welcome to the Moolah demo" });
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("button", { name: "Close" }).click();
    await dialog.waitFor({ state: "hidden" }).catch(() => {});
  }
}

async function setTheme(page: Page, dark: boolean) {
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  if (isDark !== dark) {
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await page.waitForFunction(
      (want) => document.documentElement.classList.contains("dark") === want,
      dark,
    );
  }
}

async function shot(page: Page, route: string, file: string) {
  await page.goto(`${BASE}${route}`, { waitUntil: "networkidle" });
  await dismissWelcome(page);
  await page.waitForTimeout(700); // let charts/animations settle
  await page.screenshot({ path: path.join(OUT, file), fullPage: true });
  console.log(`captured ${file}`);
}

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 2 });

  // Prime: load dashboard, dismiss the welcome modal, force light theme.
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await dismissWelcome(page);
  await setTheme(page, false);

  await shot(page, "/", "dashboard.png");
  await shot(page, "/calendar", "calendar.png");
  await shot(page, "/transactions", "transactions.png");
  await shot(page, "/recurring", "recurring.png");
  await shot(page, "/budgets", "budgets.png");
  await shot(page, "/goals", "goals.png");
  await shot(page, "/debt", "debt.png");
  await shot(page, "/accounts", "accounts.png");
  await shot(page, "/trends", "trends.png");
  await shot(page, "/categories", "categories.png");
  await shot(page, "/settings", "settings.png");

  // Dark-mode dashboard.
  await setTheme(page, true);
  await shot(page, "/", "dashboard-dark.png");

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
