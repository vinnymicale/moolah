import { describe, expect, it } from "vitest";
import { moveInArray, reconcileOrder, toggleInSet } from "./collections";

describe("toggleInSet", () => {
  it("adds a missing value without mutating the input", () => {
    const input = new Set(["a"]);
    const next = toggleInSet(input, "b");
    expect([...next]).toEqual(["a", "b"]);
    expect([...input]).toEqual(["a"]);
  });

  it("removes a present value", () => {
    expect([...toggleInSet(new Set(["a", "b"]), "a")]).toEqual(["b"]);
  });
});

describe("moveInArray", () => {
  it("moves an item later, shifting the ones it passes", () => {
    expect(moveInArray(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves an item earlier", () => {
    expect(moveInArray(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("swaps neighbours, which is what the up/down arrows do", () => {
    expect(moveInArray(["a", "b", "c"], 1, 0)).toEqual(["b", "a", "c"]);
    expect(moveInArray(["a", "b", "c"], 1, 2)).toEqual(["a", "c", "b"]);
  });

  it("does not mutate the input", () => {
    const input = ["a", "b", "c"];
    moveInArray(input, 0, 2);
    expect(input).toEqual(["a", "b", "c"]);
  });

  it("returns a copy when from equals to", () => {
    const input = ["a", "b"];
    const result = moveInArray(input, 1, 1);
    expect(result).toEqual(["a", "b"]);
    expect(result).not.toBe(input);
  });

  it("returns a copy when either index is out of range", () => {
    const input = ["a", "b"];
    const result1 = moveInArray(input, -1, 0);
    expect(result1).toEqual(["a", "b"]);
    expect(result1).not.toBe(input);
    const result2 = moveInArray(input, 0, 5);
    expect(result2).toEqual(["a", "b"]);
    expect(result2).not.toBe(input);
  });
});

describe("reconcileOrder", () => {
  it("keeps the existing order when nothing changed", () => {
    expect(reconcileOrder(["b", "a"], ["a", "b"])).toEqual(["b", "a"]);
  });

  it("drops ids that no longer exist", () => {
    expect(reconcileOrder(["c", "a", "b"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("appends ids it has not seen, preserving their incoming order", () => {
    expect(reconcileOrder(["b", "a"], ["a", "b", "c", "d"])).toEqual(["b", "a", "c", "d"]);
  });

  it("handles a simultaneous add and remove", () => {
    expect(reconcileOrder(["c", "a"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("drops duplicates in the stored order", () => {
    expect(reconcileOrder(["a", "a", "b"], ["a", "b"])).toEqual(["a", "b"]);
  });

  it("returns every available id exactly once, which reorderRulesAction requires", () => {
    const available = ["a", "b", "c"];
    const result = reconcileOrder(["c", "zzz"], available);
    expect([...result].sort()).toEqual(available);
  });

  it("returns an empty array when nothing is available", () => {
    expect(reconcileOrder(["a"], [])).toEqual([]);
  });
});
