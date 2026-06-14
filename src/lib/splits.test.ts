import { describe, it, expect } from "vitest";
import { categoryParts, sumPartsByCategory, validateSplits } from "./splits";

describe("categoryParts", () => {
  it("yields the single category for an unsplit transaction", () => {
    expect(categoryParts({ categoryId: "cat-a", amount: 50 })).toEqual([
      { categoryId: "cat-a", amount: 50 },
    ]);
  });

  it("yields one part with null category when uncategorized and unsplit", () => {
    expect(categoryParts({ categoryId: null, amount: 12.5 })).toEqual([
      { categoryId: null, amount: 12.5 },
    ]);
  });

  it("fans out into split parts when splits exist", () => {
    const parts = categoryParts({
      categoryId: null,
      amount: 86.42,
      splits: [
        { categoryId: "cat-groceries", amount: 56.42 },
        { categoryId: "cat-shopping", amount: 30 },
      ],
    });
    expect(parts).toEqual([
      { categoryId: "cat-groceries", amount: 56.42 },
      { categoryId: "cat-shopping", amount: 30 },
    ]);
  });

  it("ignores an empty splits array and falls back to the single category", () => {
    expect(categoryParts({ categoryId: "cat-a", amount: 10, splits: [] })).toEqual([
      { categoryId: "cat-a", amount: 10 },
    ]);
  });

  it("split parts sum to the transaction total", () => {
    const total = 100;
    const parts = categoryParts({
      categoryId: null,
      amount: total,
      splits: [
        { categoryId: "x", amount: 33.33 },
        { categoryId: "y", amount: 33.33 },
        { categoryId: "z", amount: 33.34 },
      ],
    });
    const sum = parts.reduce((s, p) => s + p.amount, 0);
    expect(Math.round(sum * 100)).toBe(total * 100);
  });
});

describe("sumPartsByCategory", () => {
  it("buckets unsplit rows by their single category", () => {
    const map = sumPartsByCategory([
      { categoryId: "a", amount: 10 },
      { categoryId: "a", amount: 5 },
      { categoryId: "b", amount: 20 },
    ]);
    expect(map.get("a")).toBe(15);
    expect(map.get("b")).toBe(20);
    expect(map.size).toBe(2);
  });

  it("fans split rows into their parts and mixes with unsplit rows", () => {
    const map = sumPartsByCategory([
      {
        categoryId: null,
        amount: 100,
        splits: [
          { categoryId: "groceries", amount: 60 },
          { categoryId: "shopping", amount: 40 },
        ],
      },
      { categoryId: "groceries", amount: 25 },
    ]);
    expect(map.get("groceries")).toBe(85);
    expect(map.get("shopping")).toBe(40);
  });

  it("drops uncategorized parts (null categoryId)", () => {
    const map = sumPartsByCategory([
      { categoryId: null, amount: 12.5 },
      {
        categoryId: null,
        amount: 30,
        splits: [
          { categoryId: null, amount: 10 },
          { categoryId: "x", amount: 20 },
        ],
      },
    ]);
    expect(map.has("")).toBe(false);
    expect(map.get("x")).toBe(20);
    expect(map.size).toBe(1);
  });

  it("accumulates in cents so many fractional parts don't drift", () => {
    const rows = Array.from({ length: 10 }, () => ({ categoryId: "a", amount: 0.1 }));
    const map = sumPartsByCategory(rows);
    expect(map.get("a")).toBe(1);
  });

  it("returns an empty map for no rows", () => {
    expect(sumPartsByCategory([]).size).toBe(0);
  });
});

describe("validateSplits", () => {
  it("accepts an empty split set (means not split)", () => {
    expect(validateSplits(100, [])).toBeNull();
  });

  it("rejects a single-part split", () => {
    expect(validateSplits(100, [{ categoryId: "a", amount: 100 }])).toMatch(/at least two/i);
  });

  it("rejects a zero or negative part", () => {
    expect(
      validateSplits(100, [
        { categoryId: "a", amount: 100 },
        { categoryId: "b", amount: 0 },
      ]),
    ).toMatch(/greater than zero/i);
  });

  it("rejects parts that don't sum to the total", () => {
    expect(
      validateSplits(100, [
        { categoryId: "a", amount: 40 },
        { categoryId: "b", amount: 40 },
      ]),
    ).toMatch(/add up/i);
  });

  it("accepts parts that sum to the total exactly", () => {
    expect(
      validateSplits(86.42, [
        { categoryId: "a", amount: 56.42 },
        { categoryId: "b", amount: 30 },
      ]),
    ).toBeNull();
  });

  it("compares in cents to avoid float drift", () => {
    expect(
      validateSplits(0.3, [
        { categoryId: "a", amount: 0.1 },
        { categoryId: "b", amount: 0.2 },
      ]),
    ).toBeNull();
  });

  it("rejects the same named category appearing twice", () => {
    expect(
      validateSplits(100, [
        { categoryId: "a", amount: 60 },
        { categoryId: "a", amount: 40 },
      ]),
    ).toMatch(/once/i);
  });

  it("allows multiple uncategorized parts (they fold into one null bucket)", () => {
    expect(
      validateSplits(100, [
        { categoryId: null, amount: 60 },
        { categoryId: null, amount: 40 },
      ]),
    ).toBeNull();
  });
});
