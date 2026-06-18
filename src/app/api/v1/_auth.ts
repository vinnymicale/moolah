// Shared gate for /api/v1 routes: authenticate the bearer token and apply a
// per-token rate limit. Routes call requireApiUser() and either get a userId or
// an error NextResponse to return as-is.

import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, rateLimitKeyForToken, bearerFromHeader } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";

const RATE_MAX = 60; // requests
const RATE_WINDOW_MS = 60_000; // per minute, per token

type AuthOutcome = { ok: true; userId: string } | { ok: false; response: NextResponse };

export async function requireApiUser(req: NextRequest): Promise<AuthOutcome> {
  const authHeader = req.headers.get("authorization");

  // Rate-limit by token hash (falls back to IP-ish header) before hitting the
  // DB, so a flood of bad tokens can't hammer the lookup. The anon fallback key
  // is best-effort only: x-forwarded-for is client-spoofable, so a determined
  // attacker can rotate it to dodge the limit. That's acceptable here - the
  // limiter's job is to blunt accidental loops and casual probing, and any
  // request without a valid token gets a 401 regardless.
  const raw = bearerFromHeader(authHeader);
  const selector = raw ? rateLimitKeyForToken(raw) : null;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  const rlKey = selector ? `apiv1:${selector}` : `apiv1:anon:${fwd || "local"}`;
  const rl = checkRateLimit(rlKey, RATE_MAX, RATE_WINDOW_MS);
  if (!rl.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Rate limit exceeded" },
        { status: 429, headers: { "Retry-After": String(rl.retryAfterSec) } },
      ),
    };
  }

  const user = await authenticateApiRequest(authHeader);
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "Unauthorized" },
        { status: 401, headers: { "WWW-Authenticate": "Bearer" } },
      ),
    };
  }
  return { ok: true, userId: user.userId };
}

/** Current API version, surfaced on every response and the discovery root. */
export const API_VERSION = "1";

/**
 * Consistent JSON envelope so consumers can rely on a stable shape. Stamps every
 * response with the API version and forbids caching - this is live financial
 * data, and a poller (e.g. Home Assistant) should always see current balances.
 */
export function apiJson(data: unknown, init?: ResponseInit): NextResponse {
  const res = NextResponse.json(data, init);
  res.headers.set("X-Api-Version", API_VERSION);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

/**
 * JSON 405 for a read-only route that was hit with a write method. Advertises
 * the allowed method so a consumer gets a clean, machine-readable rejection
 * instead of Next's default HTML error page.
 */
export function methodNotAllowed(allow = "GET"): NextResponse {
  return apiJson(
    { error: "Method not allowed" },
    { status: 405, headers: { Allow: allow } },
  );
}

/**
 * Write-method handlers for a GET-only route. Spread into a route module
 * (`export const { POST, PUT, PATCH, DELETE } = readOnlyMethods;`) so a write
 * attempt gets a clean JSON 405 instead of Next's HTML 405.
 */
export const readOnlyMethods = {
  POST: () => methodNotAllowed(),
  PUT: () => methodNotAllowed(),
  PATCH: () => methodNotAllowed(),
  DELETE: () => methodNotAllowed(),
};
