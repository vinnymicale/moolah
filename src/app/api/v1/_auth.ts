// Shared gate for /api/v1 routes: authenticate the bearer token and apply a
// per-token rate limit. Routes call requireApiUser() and either get a userId or
// an error NextResponse to return as-is.

import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest, hashApiToken, bearerFromHeader } from "@/lib/api-auth";
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
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0].trim();
  const rlKey = raw ? `apiv1:${hashApiToken(raw)}` : `apiv1:anon:${fwd || "local"}`;
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

/** Consistent JSON envelope so consumers can rely on a stable shape. */
export function apiJson(data: unknown, init?: ResponseInit): NextResponse {
  return NextResponse.json(data, init);
}
