import { describe, it, expect, beforeEach, vi } from "vitest";
import { readStored, writeStored } from "./storage";

function mockLocalStorage() {
  const store = new Map<string, string>();
  return {
    getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    store,
  };
}

describe("readStored / writeStored", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the fallback when window is undefined (SSR)", () => {
    // jsdom is not loaded here (node env), so window is already undefined.
    expect(typeof window).toBe("undefined");
    expect(readStored("k", "fb")).toBe("fb");
    expect(() => writeStored("k", 1)).not.toThrow();
  });

  it("round-trips JSON values through localStorage", () => {
    const ls = mockLocalStorage();
    vi.stubGlobal("window", { localStorage: ls });
    writeStored("count", 5);
    writeStored("obj", { a: [1, 2] });
    expect(readStored("count", 0)).toBe(5);
    expect(readStored("obj", null)).toEqual({ a: [1, 2] });
  });

  it("returns the fallback for a missing key", () => {
    vi.stubGlobal("window", { localStorage: mockLocalStorage() });
    expect(readStored("nope", "fb")).toBe("fb");
  });

  it("returns the fallback when the stored value is malformed JSON", () => {
    const ls = mockLocalStorage();
    ls.store.set("bad", "{not json");
    vi.stubGlobal("window", { localStorage: ls });
    expect(readStored("bad", "fb")).toBe("fb");
  });

  it("swallows write errors (e.g. quota exceeded)", () => {
    vi.stubGlobal("window", {
      localStorage: {
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      },
    });
    expect(() => writeStored("k", "v")).not.toThrow();
  });
});
