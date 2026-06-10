// Environment validation.
//
// Validated lazily via checkEnv(), never at import time: Next.js imports modules
// while collecting page data at build, where no env vars are set, so an
// import-time throw would break the build (same reason plaid.ts is lazy). Call
// checkEnv() from a runtime path - e.g. the health endpoint - to surface
// misconfiguration with a clear message instead of a cryptic downstream failure.

import { z } from "zod";

const boolish = z.enum(["true", "false"]).optional();

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  AUTH_SECRET: z.string().optional(),
  AUTH_GOOGLE_ID: z.string().optional(),
  AUTH_GOOGLE_SECRET: z.string().optional(),
  AUTH_BYPASS: boolish,
  AUTH_DEV_LOGIN: boolish,
  DEMO_MODE: boolish,
  PLAID_CLIENT_ID: z.string().optional(),
  PLAID_SECRET: z.string().optional(),
  PLAID_ENV: z.enum(["sandbox", "production"]).optional(),
});

export interface EnvCheck {
  ok: boolean;
  errors: string[];
}

/**
 * Validate the environment for the current run mode. Returns the problems
 * rather than throwing so callers (health checks, startup logs) can decide how
 * loud to be. Cross-field rules encode the modes documented in .env.example:
 *   - production (not demo, not bypass) requires a real AUTH_SECRET and a
 *     login method (Google OAuth or explicit dev-login).
 *   - Plaid credentials must be present as a pair or not at all.
 */
export function checkEnv(env: NodeJS.ProcessEnv = process.env): EnvCheck {
  const errors: string[] = [];

  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const field = issue.path.join(".");
      errors.push(field ? `${field}: ${issue.message}` : issue.message);
    }
    return { ok: false, errors };
  }
  const e = parsed.data;

  const demo = e.DEMO_MODE === "true";
  const bypass = e.AUTH_BYPASS === "true";
  const isProd = env.NODE_ENV === "production";

  if (isProd && !demo && !bypass) {
    if (!e.AUTH_SECRET) {
      errors.push("AUTH_SECRET is required in production (generate with: npx auth secret)");
    }
    const hasGoogle = !!(e.AUTH_GOOGLE_ID && e.AUTH_GOOGLE_SECRET);
    const hasDevLogin = e.AUTH_DEV_LOGIN === "true";
    if (!hasGoogle && !hasDevLogin) {
      errors.push("No sign-in method configured: set AUTH_GOOGLE_ID + AUTH_GOOGLE_SECRET, or AUTH_DEV_LOGIN=true");
    }
  }

  if (!!e.PLAID_CLIENT_ID !== !!e.PLAID_SECRET) {
    errors.push("PLAID_CLIENT_ID and PLAID_SECRET must be set together");
  }

  return { ok: errors.length === 0, errors };
}
