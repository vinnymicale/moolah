import { describe, it, expect } from "vitest";
import { toNumber, toCents, fromCents, sumMoney, formatUSD, formatSigned } from "./money";

describe("toNumber", () => {
  it("passes numbers through", () => {
    expect(toNumber(12.34)).toBe(12.34);
  });

  it("parses strings and Decimal-like objects", () => {
    expect(toNumber("12.34")).toBe(12.34);
    expect(toNumber({ toString: () => "99.95" })).toBe(99.95);
  });

  it("returns 0 for null, undefined, and garbage", () => {
    expect(toNumber(null)).toBe(0);
    expect(toNumber(undefined)).toBe(0);
    expect(toNumber("not-a-number")).toBe(0);
  });
});

describe("sumMoney", () => {
  it("avoids binary float drift", () => {
    // 0.1 + 0.2 !== 0.3 in raw floats; cent-based summation must be exact.
    expect(sumMoney([0.1, 0.2])).toBe(0.3);
    expect(sumMoney(Array(10).fill(0.1))).toBe(1);
  });

  it("sums mixed input types", () => {
    expect(sumMoney([1.5, "2.25", { toString: () => "0.25" }, null])).toBe(4);
  });
});

describe("toCents / fromCents", () => {
  it("rounds to the nearest cent", () => {
    expect(toCents(10.005)).toBe(1001);
    expect(toCents("19.99")).toBe(1999);
    expect(fromCents(1999)).toBe(19.99);
  });
});

describe("formatting", () => {
  it("formats USD", () => {
    expect(formatUSD(1234.56)).toBe("$1,234.56");
    expect(formatUSD(-1234.56)).toBe("-$1,234.56");
  });

  it("formats signed deltas with explicit +/-", () => {
    expect(formatSigned(50)).toBe("+$50.00");
    expect(formatSigned(-50)).toBe("-$50.00");
    expect(formatSigned(0)).toBe("$0.00");
  });
});
