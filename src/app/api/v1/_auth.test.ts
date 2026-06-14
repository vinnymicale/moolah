import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { requireApiUser } from "./_auth";
import { authenticateApiRequest } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";

vi.mock("@/lib/api-auth", async (orig) => {
  const actual = await orig<typeof import("@/lib/api-auth")>();
  return { ...actual, authenticateApiRequest: vi.fn() };
});
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn() }));

const authn = vi.mocked(authenticateApiRequest);
const rl = vi.mocked(checkRateLimit);

function req(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/v1/summary", { headers });
}

describe("requireApiUser", () => {
  beforeEach(() => {
    authn.mockReset();
    rl.mockReset();
    rl.mockReturnValue({ allowed: true, retryAfterSec: 0 });
  });

  it("returns the userId for a valid token", async () => {
    authn.mockResolvedValue({ userId: "u1" });
    const out = await requireApiUser(req({ authorization: "Bearer good" }));
    expect(out).toEqual({ ok: true, userId: "u1" });
  });

  it("401s with a WWW-Authenticate header when the token is invalid", async () => {
    authn.mockResolvedValue(null);
    const out = await requireApiUser(req({ authorization: "Bearer bad" }));
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected failure");
    expect(out.response.status).toBe(401);
    expect(out.response.headers.get("WWW-Authenticate")).toBe("Bearer");
  });

  it("429s with Retry-After before touching the DB when rate-limited", async () => {
    rl.mockReturnValue({ allowed: false, retryAfterSec: 30 });
    const out = await requireApiUser(req({ authorization: "Bearer good" }));
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("expected failure");
    expect(out.response.status).toBe(429);
    expect(out.response.headers.get("Retry-After")).toBe("30");
    expect(authn).not.toHaveBeenCalled();
  });

  it("rate-limits anon requests by the first x-forwarded-for hop", async () => {
    authn.mockResolvedValue(null);
    await requireApiUser(req({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));
    expect(rl).toHaveBeenCalledWith("apiv1:anon:203.0.113.7", expect.any(Number), expect.any(Number));
  });
});
