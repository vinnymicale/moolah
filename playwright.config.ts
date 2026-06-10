import { defineConfig, devices } from "@playwright/test";

// E2E tests run against the production build in demo mode. Demo mode reads
// from a seeded database (run `npm run db:seed` first) and blocks all writes,
// so tests are repeatable without touching real data.
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
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
  ],
  webServer: {
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
});
