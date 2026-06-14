// Capture just the Settings page against a normal (non-demo) signed-in session.
// Demo mode hides the real settings UI, so this runs against AUTH_BYPASS=true.

import { chromium } from "playwright";
import path from "node:path";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const OUT = path.join(process.cwd(), "docs", "screenshots");

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });

  // Land on the app root first so the bypass session cookie is set, then go to
  // settings (which otherwise redirects to /signin on a cold direct hit).
  await page.goto(`${BASE}/`, { waitUntil: "networkidle" });
  await page.goto(`${BASE}/settings`, { waitUntil: "networkidle" });

  // Force light theme for a consistent gallery.
  const isDark = await page.evaluate(() => document.documentElement.classList.contains("dark"));
  if (isDark) {
    await page.getByRole("button", { name: "Toggle theme" }).click();
    await page.waitForFunction(() => !document.documentElement.classList.contains("dark"));
  }

  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(OUT, "settings.png"), fullPage: true });
  console.log("captured settings.png ->", page.url());

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
