import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret } from "./crypto";

const ORIGINAL_SECRET = process.env.AUTH_SECRET;

beforeEach(() => {
  process.env.AUTH_SECRET = "test-secret-for-unit-tests";
});

afterEach(() => {
  process.env.AUTH_SECRET = ORIGINAL_SECRET;
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips a value", () => {
    const stored = encryptSecret("sk-ant-api03-abc123");
    expect(decryptSecret(stored)).toBe("sk-ant-api03-abc123");
  });

  it("produces the enc:v1 format and never stores plaintext", () => {
    const stored = encryptSecret("sk-super-secret");
    expect(stored).toMatch(/^enc:v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain("sk-super-secret");
  });

  it("uses a fresh IV per call (same input encrypts differently)", () => {
    expect(encryptSecret("same")).not.toBe(encryptSecret("same"));
  });

  it("passes legacy plaintext rows through unchanged", () => {
    expect(decryptSecret("sk-legacy-plaintext-key")).toBe("sk-legacy-plaintext-key");
  });

  it("round-trips unicode", () => {
    const value = "clé-secrète-日本語-🔑";
    expect(decryptSecret(encryptSecret(value))).toBe(value);
  });

  it("fails on tampered ciphertext", () => {
    const stored = encryptSecret("payload");
    const tampered = stored.slice(0, -4) + (stored.endsWith("AAAA") ? "BBBB" : "AAAA");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("fails when decrypting with a different AUTH_SECRET", () => {
    const stored = encryptSecret("payload");
    process.env.AUTH_SECRET = "a-different-secret";
    expect(() => decryptSecret(stored)).toThrow();
  });

  it("refuses to encrypt without AUTH_SECRET", () => {
    delete process.env.AUTH_SECRET;
    expect(() => encryptSecret("x")).toThrow(/AUTH_SECRET/);
  });
});
