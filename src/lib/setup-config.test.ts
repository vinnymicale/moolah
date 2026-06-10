import { describe, it, expect } from "vitest";
import { isLocalHost } from "./setup-config";

// Security-relevant: this gates the .env-writing setup endpoint.
describe("isLocalHost", () => {
  it("accepts localhost forms with and without ports", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("localhost:3000")).toBe(true);
    expect(isLocalHost("127.0.0.1:3000")).toBe(true);
    expect(isLocalHost("LOCALHOST")).toBe(true);
  });

  it("accepts bracketed IPv6 loopback", () => {
    expect(isLocalHost("[::1]:3000")).toBe(true);
  });

  it("rejects everything else, including lookalikes", () => {
    expect(isLocalHost(null)).toBe(false);
    expect(isLocalHost(undefined)).toBe(false);
    expect(isLocalHost("")).toBe(false);
    expect(isLocalHost("moolah-five.vercel.app")).toBe(false);
    expect(isLocalHost("evil-localhost.com")).toBe(false);
    expect(isLocalHost("localhost.attacker.com")).toBe(false);
    expect(isLocalHost("192.168.1.10:3000")).toBe(false);
  });
});
