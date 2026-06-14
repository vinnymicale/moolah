import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  generateApiToken,
  hashApiToken,
  bearerFromHeader,
  authenticateApiRequest,
} from "./api-auth";
import { prisma } from "@/lib/prisma";

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));

const findUnique = vi.mocked(prisma.user.findUnique);

describe("generateApiToken", () => {
  it("produces a prefixed, high-entropy token", () => {
    const t = generateApiToken();
    expect(t.startsWith("moolah_")).toBe(true);
    // base64url of 24 bytes is 32 chars, plus the prefix.
    expect(t.length).toBeGreaterThan(30);
  });

  it("produces a different token each call", () => {
    expect(generateApiToken()).not.toBe(generateApiToken());
  });
});

describe("hashApiToken", () => {
  it("is deterministic for the same input", () => {
    const t = generateApiToken();
    expect(hashApiToken(t)).toBe(hashApiToken(t));
  });

  it("is a 64-char hex SHA-256 digest", () => {
    expect(hashApiToken("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("never returns the raw token", () => {
    const t = generateApiToken();
    expect(hashApiToken(t)).not.toContain(t);
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
    const hash = hashApiToken(token);
    findUnique.mockResolvedValue({ id: "u1" } as never);

    const result = await authenticateApiRequest(`Bearer ${token}`);
    expect(result).toEqual({ userId: "u1" });
    // Looked up by the hash, never the raw token.
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { apiTokenHash: hash } }),
    );
  });

  it("returns null when no user matches the token", async () => {
    findUnique.mockResolvedValue(null);
    expect(await authenticateApiRequest(`Bearer ${generateApiToken()}`)).toBeNull();
  });

  it("returns null when the header is missing", async () => {
    expect(await authenticateApiRequest(null)).toBeNull();
    expect(findUnique).not.toHaveBeenCalled();
  });
});
