import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { encryptSecret, decryptSecret } from "./crypto";

const ORIGINAL_SECRET = process.env.AUTH_SECRET;
const ORIGINAL_ENC = process.env.ENCRYPTION_KEY;

beforeEach(() => {
  delete process.env.ENCRYPTION_KEY;
  process.env.AUTH_SECRET = "test-secret-for-unit-tests";
});

afterEach(() => {
  process.env.AUTH_SECRET = ORIGINAL_SECRET;
  if (ORIGINAL_ENC === undefined) delete process.env.ENCRYPTION_KEY;
  else process.env.ENCRYPTION_KEY = ORIGINAL_ENC;
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

  it("refuses to encrypt without any key configured", () => {
    delete process.env.AUTH_SECRET;
    delete process.env.ENCRYPTION_KEY;
    expect(() => encryptSecret("x")).toThrow(/ENCRYPTION_KEY or AUTH_SECRET/);
  });

  it("prefers ENCRYPTION_KEY so AUTH_SECRET can rotate without breaking secrets", () => {
    process.env.ENCRYPTION_KEY = "dedicated-encryption-key";
    const stored = encryptSecret("payload");
    // Rotating the session secret leaves stored secrets decryptable.
    process.env.AUTH_SECRET = "rotated-auth-secret";
    expect(decryptSecret(stored)).toBe("payload");
  });

  it("falls back to AUTH_SECRET when ENCRYPTION_KEY is unset", () => {
    const stored = encryptSecret("payload"); // keyed off AUTH_SECRET
    expect(decryptSecret(stored)).toBe("payload");
  });

  it("a value encrypted under ENCRYPTION_KEY won't decrypt under AUTH_SECRET alone", () => {
    process.env.ENCRYPTION_KEY = "dedicated-encryption-key";
    const stored = encryptSecret("payload");
    delete process.env.ENCRYPTION_KEY; // now keying falls back to AUTH_SECRET
    expect(() => decryptSecret(stored)).toThrow();
  });
});
