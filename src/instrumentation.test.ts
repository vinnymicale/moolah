// The schedulers themselves are covered by their own suites; what matters here
// is the AUTH_BYPASS warning. Bypass signs every visitor in as one account,
// which quietly defeats the whole permission model, so a household instance
// left in that mode should say so on every boot.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/backup/scheduler", () => ({ startScheduler: vi.fn() }));
vi.mock("@/lib/notifications/scheduler", () => ({ startNotificationScheduler: vi.fn() }));
vi.mock("@/lib/plaid-scheduler", () => ({ startPlaidSyncScheduler: vi.fn() }));

import { register } from "./instrumentation";

describe("register", () => {
  const env = process.env;
  let warn: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env = { ...env, NEXT_RUNTIME: "nodejs", DEMO_MODE: "false", AUTH_BYPASS: "false" };
    warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    process.env = env;
    warn.mockRestore();
  });

  it("warns when AUTH_BYPASS is on", async () => {
    process.env.AUTH_BYPASS = "true";
    await register();
    const message = warn.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");
    expect(message).toContain("AUTH_BYPASS");
  });

  it("stays quiet when bypass is off", async () => {
    await register();
    expect(warn).not.toHaveBeenCalled();
  });

  it("warns before the demo-mode early return", async () => {
    // Demo mode skips the schedulers, but a warning about how people sign in is
    // still worth printing.
    process.env.DEMO_MODE = "true";
    process.env.AUTH_BYPASS = "true";
    await register();
    expect(warn).toHaveBeenCalled();
  });
});
