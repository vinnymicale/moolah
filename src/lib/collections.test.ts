import { describe, it, expect } from "vitest";
import { toggleInSet } from "./collections";

describe("toggleInSet", () => {
  it("adds a value when absent", () => {
    expect([...toggleInSet(new Set([1, 2]), 3)]).toEqual([1, 2, 3]);
  });

  it("removes a value when present", () => {
    expect([...toggleInSet(new Set([1, 2, 3]), 2)]).toEqual([1, 3]);
  });

  it("does not mutate the original set", () => {
    const original = new Set([1]);
    toggleInSet(original, 2);
    expect([...original]).toEqual([1]);
  });
});
