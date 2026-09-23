import { defineConfig, devices } from "@playwright/test";

// E2E tests run against the production build in demo mode. Demo mode reads
// from a seeded database (run `npm run db:seed` first) and blocks all writes,
// so tests are repeatable without touching real data.
//
// The household suite is the exception: permissions only mean anything with
// real sign-in and writes allowed, so it gets a second server on its own port.
// AUTH_URL has to match that port or the sign-in callback lands nowhere.
const HOUSEHOLD_URL = "http://localhost:3101";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  reporter: process.env.CI ? "github" : "list",
  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
      testIgnore: /households\.spec\.ts/,
    },
    {
      name: "households",
      use: { ...devices["Desktop Chrome"], baseURL: HOUSEHOLD_URL },
      testMatch: /households\.spec\.ts/,
    },
  ],
  webServer: [
    {
      command: "npm start",
      url: "http://localhost:3000",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        DEMO_MODE: "true",
        AUTH_BYPASS: "true",
        // In CI the DB comes from the service container; locally next start
        // reads .env itself, so only forward an explicitly-set value.
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      },
    },
    {
      command: "npm start -- --port 3101",
      url: HOUSEHOLD_URL,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        DEMO_MODE: "false",
        AUTH_BYPASS: "false",
        AUTH_URL: HOUSEHOLD_URL,
        ...(process.env.DATABASE_URL ? { DATABASE_URL: process.env.DATABASE_URL } : {}),
      },
    },
  ],
});
