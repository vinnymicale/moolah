import { describe, it, expect } from "vitest";
import { checkEnv } from "./env";

const baseProd = {
  NODE_ENV: "production",
  DATABASE_URL: "postgresql://x",
  AUTH_SECRET: "secret",
} as NodeJS.ProcessEnv;

describe("checkEnv", () => {
  it("requires DATABASE_URL", () => {
    const r = checkEnv({ NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/DATABASE_URL/);
  });

  it("passes a fully configured production env", () => {
    expect(checkEnv(baseProd)).toEqual({ ok: true, errors: [] });
  });

  it("requires AUTH_SECRET in production when not demo/bypass", () => {
    const r = checkEnv({ ...baseProd, AUTH_SECRET: undefined });
    expect(r.ok).toBe(false);
    expect(r.errors.join(" ")).toMatch(/AUTH_SECRET/);
  });

  it("relaxes auth requirements in demo mode", () => {
    const r = checkEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://x",
      DEMO_MODE: "true",
    } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
  });

  it("relaxes auth requirements when bypass is on", () => {
    const r = checkEnv({
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://x",
      AUTH_BYPASS: "true",
    } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
  });

  it("does not require auth outside production", () => {
    const r = checkEnv({ NODE_ENV: "development", DATABASE_URL: "postgresql://x" } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(true);
  });

  it("rejects a lone Plaid credential", () => {
    expect(checkEnv({ ...baseProd, PLAID_CLIENT_ID: "id" }).ok).toBe(false);
    expect(checkEnv({ ...baseProd, PLAID_SECRET: "sec" }).ok).toBe(false);
    expect(checkEnv({ ...baseProd, PLAID_CLIENT_ID: "id", PLAID_SECRET: "sec" }).ok).toBe(true);
  });

  it("rejects an unknown PLAID_ENV", () => {
    const r = checkEnv({ ...baseProd, PLAID_ENV: "development" } as NodeJS.ProcessEnv);
    expect(r.ok).toBe(false);
  });
});
