import { describe, it, expect } from "vitest";
import { CHART_TOKEN_FALLBACKS, gridFromLine, resolveChartTheme } from "./chart-theme";

describe("gridFromLine", () => {
  it("expands a 6-digit hex to a translucent rgba", () => {
    expect(gridFromLine("#1a2b3c")).toBe("rgba(26, 43, 60, 0.4)");
  });

  it("expands a 3-digit shorthand hex", () => {
    expect(gridFromLine("#abc")).toBe("rgba(170, 187, 204, 0.4)");
  });

  it("returns empty for anything that isn't a hex", () => {
    expect(gridFromLine("")).toBe("");
    expect(gridFromLine("rgb(1,2,3)")).toBe("");
    expect(gridFromLine("#12")).toBe("");
    expect(gridFromLine("#gggggg")).toBe("");
  });
});

describe("resolveChartTheme", () => {
  it("falls back to the light-theme defaults when no tokens resolve", () => {
    const theme = resolveChartTheme(() => "");
    expect(theme).toEqual(CHART_TOKEN_FALLBACKS);
  });

  it("reads tokens off the reader and derives grid from --line", () => {
    const tokens: Record<string, string> = {
      "--muted": "#777777",
      "--line": "#000000",
      "--income": "#00ff00",
      "--expense": "#ff0000",
    };
    const theme = resolveChartTheme((t) => tokens[t] ?? "");
    expect(theme.axis).toBe("#777777");
    expect(theme.grid).toBe("rgba(0, 0, 0, 0.4)");
    expect(theme.income).toBe("#00ff00");
    expect(theme.expense).toBe("#ff0000");
  });

  it("keeps the indigo brand accent regardless of tokens", () => {
    const theme = resolveChartTheme(() => "#123456");
    expect(theme.brand).toBe(CHART_TOKEN_FALLBACKS.brand);
  });

  it("falls back to the neutral grid when --line isn't a hex", () => {
    const theme = resolveChartTheme((t) => (t === "--line" ? "transparent" : ""));
    expect(theme.grid).toBe(CHART_TOKEN_FALLBACKS.grid);
  });

  it("trims whitespace from resolved token values", () => {
    const theme = resolveChartTheme((t) => (t === "--muted" ? "  #abcabc  " : ""));
    expect(theme.axis).toBe("#abcabc");
  });
});
