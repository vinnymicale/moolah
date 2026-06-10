import { describe, it, expect } from "vitest";
import { matchCategoryRule } from "./category-rules";

const rules = [
  { pattern: "costco", categoryId: "groceries" },
  { pattern: "costco gas", categoryId: "fuel" },
  { pattern: "NETFLIX", categoryId: "subscriptions" },
];

describe("matchCategoryRule", () => {
  it("matches case-insensitively in both directions", () => {
    expect(matchCategoryRule("COSTCO WHSE #123", rules)).toBe("groceries");
    expect(matchCategoryRule("netflix.com", rules)).toBe("subscriptions");
  });

  it("prefers the longest (most specific) pattern", () => {
    expect(matchCategoryRule("COSTCO GAS #0451", rules)).toBe("fuel");
  });

  it("returns null with no match or no rules", () => {
    expect(matchCategoryRule("Trader Joes", rules)).toBeNull();
    expect(matchCategoryRule("Costco", [])).toBeNull();
  });

  it("ignores blank patterns", () => {
    expect(matchCategoryRule("anything", [{ pattern: "  ", categoryId: "x" }])).toBeNull();
  });
});
