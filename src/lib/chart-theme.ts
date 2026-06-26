// Chart colors that need to follow the active light/dark theme. recharts wants
// concrete color strings (it can't read CSS custom properties), so we resolve
// the relevant design tokens off the document at render time. The pure helpers
// here are split out so they can be unit-tested without a DOM.

export interface ChartTheme {
  axis: string;
  grid: string;
  income: string;
  expense: string;
  brand: string;
}

/** The tokens we read, and their fallbacks if the document isn't available
 *  (SSR / first paint) or a var resolves empty. Fallbacks mirror the light
 *  theme so the server-rendered chart matches the initial client paint. */
export const CHART_TOKEN_FALLBACKS: ChartTheme = {
  axis: "#94a3b8",
  grid: "rgba(148,163,184,0.2)",
  income: "#16a34a",
  expense: "#dc2626",
  brand: "#4f46e5",
};

/**
 * Build a ChartTheme from a token reader. `read` returns the trimmed value of a
 * CSS custom property (e.g. "--income"), or "" when unavailable. The grid line
 * is derived from --line at low opacity so it tracks the theme too; when --line
 * isn't readable we keep the neutral slate fallback.
 */
export function resolveChartTheme(read: (token: string) => string): ChartTheme {
  const pick = (token: string, fallback: string) => {
    const v = read(token).trim();
    return v || fallback;
  };
  return {
    axis: pick("--muted", CHART_TOKEN_FALLBACKS.axis),
    grid: gridFromLine(read("--line").trim()) || CHART_TOKEN_FALLBACKS.grid,
    income: pick("--income", CHART_TOKEN_FALLBACKS.income),
    expense: pick("--expense", CHART_TOKEN_FALLBACKS.expense),
    brand: CHART_TOKEN_FALLBACKS.brand, // brand is near-mono; charts use the indigo accent
  };
}

/** Turn a solid --line hex into a translucent gridline color. Returns "" for
 *  anything that isn't a 3/6-digit hex so the caller can fall back. */
export function gridFromLine(line: string): string {
  const m = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.exec(line);
  if (!m) return "";
  let hex = m[1];
  if (hex.length === 3) hex = hex.split("").map((c) => c + c).join("");
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, 0.4)`;
}
