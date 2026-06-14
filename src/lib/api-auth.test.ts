import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateApiToken,
  parseApiToken,
  hashApiTokenVerifier,
  verifyApiTokenVerifier,
  rateLimitKeyForToken,
  bearerFromHeader,
  authenticateApiRequest,
} from "./api-auth";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

const findUnique = vi.mocked(prisma.user.findUnique);

describe("generateApiToken", () => {
  it("produces a prefixed selector.verifier token", () => {
    const t = generateApiToken();
    expect(t.startsWith("moolah_")).toBe(true);
    const parsed = parseApiToken(t);
    expect(parsed).not.toBeNull();
    expect(parsed!.selector.length).toBeGreaterThan(0);
    expect(parsed!.verifier.length).toBeGreaterThan(0);
  });

  it("produces a different token each call", () => {
    expect(generateApiToken()).not.toBe(generateApiToken());
  });
});

describe("parseApiToken", () => {
  it("splits a well-formed token", () => {
    expect(parseApiToken("moolah_sel.ver")).toEqual({ selector: "sel", verifier: "ver" });
  });

  it("returns null for a missing prefix, dot, or empty half", () => {
    expect(parseApiToken("sel.ver")).toBeNull();
    expect(parseApiToken("moolah_selver")).toBeNull();
    expect(parseApiToken("moolah_.ver")).toBeNull();
    expect(parseApiToken("moolah_sel.")).toBeNull();
  });
});

describe("hashApiTokenVerifier / verifyApiTokenVerifier", () => {
  it("verifies a verifier against its own hash", () => {
    const hash = hashApiTokenVerifier("secret-verifier");
    expect(verifyApiTokenVerifier("secret-verifier", hash)).toBe(true);
  });

  it("rejects the wrong verifier", () => {
    const hash = hashApiTokenVerifier("secret-verifier");
    expect(verifyApiTokenVerifier("not-it", hash)).toBe(false);
  });

  it("salts each hash, so the same input hashes differently", () => {
    expect(hashApiTokenVerifier("x")).not.toBe(hashApiTokenVerifier("x"));
  });

  it("stores salt:derivedKey hex and never the raw verifier", () => {
    const hash = hashApiTokenVerifier("secret-verifier");
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(hash).not.toContain("secret-verifier");
  });

  it("rejects a malformed stored hash", () => {
    expect(verifyApiTokenVerifier("x", "garbage")).toBe(false);
  });
});

describe("rateLimitKeyForToken", () => {
  it("returns the selector for a valid token", () => {
    const t = generateApiToken();
    expect(rateLimitKeyForToken(t)).toBe(parseApiToken(t)!.selector);
  });

  it("returns null for a malformed token", () => {
    expect(rateLimitKeyForToken("nope")).toBeNull();
  });
});

describe("bearerFromHeader", () => {
  it("extracts the token from a Bearer header", () => {
    expect(bearerFromHeader("Bearer abc123")).toBe("abc123");
  });

  it("is case-insensitive on the scheme", () => {
    expect(bearerFromHeader("bearer abc123")).toBe("abc123");
  });

  it("trims surrounding whitespace", () => {
    expect(bearerFromHeader("  Bearer   abc123  ")).toBe("abc123");
  });

  it("returns null for a missing or malformed header", () => {
    expect(bearerFromHeader(null)).toBeNull();
    expect(bearerFromHeader("")).toBeNull();
    expect(bearerFromHeader("Basic abc123")).toBeNull();
    expect(bearerFromHeader("abc123")).toBeNull();
  });
});

describe("authenticateApiRequest", () => {
  beforeEach(() => findUnique.mockReset());

  it("returns the user for a valid token", async () => {
    const token = generateApiToken();
    const { selector, verifier } = parseApiToken(token)!;
    findUnique.mockResolvedValue({
      id: "u1",
      apiTokenVerifierHash: hashApiTokenVerifier(verifier),
    } as never);

    const result = await authenticateApiRequest(`Bearer ${token}`);
    expect(result).toEqual({ userId: "u1" });
    // Looked up by the non-secret selector, never the raw token.
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { apiTokenSelector: selector } }),
    );
  });

  it("returns null when the verifier doesn't match the stored hash", async () => {
    const token = generateApiToken();
    findUnique.mockResolvedValue({
      id: "u1",
      apiTokenVerifierHash: hashApiTokenVerifier("a-different-verifier"),
    } as never);
    expect(await authenticateApiRequest(`Bearer ${token}`)).toBeNull();
  });

  it("returns null when no user matches the selector", async () => {
    findUnique.mockResolvedValue(null);
    expect(await authenticateApiRequest(`Bearer ${generateApiToken()}`)).toBeNull();
  });

  it("returns null for a malformed token without hitting the DB", async () => {
    expect(await authenticateApiRequest("Bearer not-a-real-token")).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("returns null when the header is missing", async () => {
    expect(await authenticateApiRequest(null)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
