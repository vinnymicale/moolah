import { describe, it, expect, afterEach } from "vitest";
import { isDemoMode } from "./demo-guard";

describe("isDemoMode", () => {
  const original = process.env.DEMO_MODE;
  afterEach(() => {
    if (original === undefined) delete process.env.DEMO_MODE;
    else process.env.DEMO_MODE = original;
  });

  it("is true only when DEMO_MODE is exactly the string 'true'", () => {
    process.env.DEMO_MODE = "true";
    expect(isDemoMode()).toBe(true);
  });

  it("is false when unset", () => {
    delete process.env.DEMO_MODE;
    expect(isDemoMode()).toBe(false);
  });

  it("is false for other truthy-looking values", () => {
    for (const v of ["TRUE", "1", "yes", "false", ""]) {
      process.env.DEMO_MODE = v;
      expect(isDemoMode()).toBe(false);
    }
  });
});
