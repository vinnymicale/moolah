import { describe, it, expect } from "vitest";
import { categoryColor, DEFAULT_CATEGORY_COLOR, INCOME_COLOR, COLOR_PALETTE } from "./colors";

describe("categoryColor", () => {
  it("uses the category's own color when set", () => {
    expect(categoryColor({ color: "#123456" })).toBe("#123456");
    expect(categoryColor({ color: "#123456" }, "INCOME")).toBe("#123456");
  });

  it("falls back to the income accent for uncategorized income", () => {
    expect(categoryColor(null, "INCOME")).toBe(INCOME_COLOR);
    expect(categoryColor({ color: null }, "INCOME")).toBe(INCOME_COLOR);
  });

  it("falls back to the neutral swatch otherwise", () => {
    expect(categoryColor(null)).toBe(DEFAULT_CATEGORY_COLOR);
    expect(categoryColor(undefined, "EXPENSE")).toBe(DEFAULT_CATEGORY_COLOR);
    expect(categoryColor({ color: "" }, "EXPENSE")).toBe(DEFAULT_CATEGORY_COLOR);
  });
});

describe("COLOR_PALETTE", () => {
  it("holds unique hex swatches", () => {
    expect(new Set(COLOR_PALETTE).size).toBe(COLOR_PALETTE.length);
    for (const c of COLOR_PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/);
  });
});
