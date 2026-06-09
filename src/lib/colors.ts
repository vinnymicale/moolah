// Shared color tokens. The app stores per-entity colors as hex strings (set via
// the color pickers below); these constants cover the fallbacks and accents used
// when an entity has no color of its own.

/** Slate-500. Fallback swatch for uncategorized transactions. */
export const DEFAULT_CATEGORY_COLOR = "#64748b";
/** Green-600. Income, and "goal complete" accents. */
export const INCOME_COLOR = "#16a34a";
/** Slate-400. Credit-card payment transfers (cash-flow neutral). */
export const TRANSFER_COLOR = "#94a3b8";
/** Red-600. Over-budget and other negative accents. */
export const NEGATIVE_COLOR = "#dc2626";
/** Indigo-600. The brand accent, used for chart lines. */
export const BRAND_COLOR = "#4f46e5";
/** Slate-400. Axis ticks and gridlines in charts. */
export const CHART_AXIS_COLOR = "#94a3b8";

/** The swatches offered by every color picker (accounts, categories, goals). */
export const COLOR_PALETTE = [
  "#dc2626", "#ea580c", "#d97706", "#65a30d", "#16a34a", "#0d9488",
  "#0891b2", "#2563eb", "#4f46e5", "#7c3aed", "#9333ea", "#db2777", "#64748b",
];

/**
 * Resolve the display color for a category-bearing row. Falls back to the income
 * accent for uncategorized income and to the neutral swatch otherwise.
 */
export function categoryColor(
  cat: { color?: string | null } | null | undefined,
  type?: "INCOME" | "EXPENSE",
): string {
  if (cat?.color) return cat.color;
  return type === "INCOME" ? INCOME_COLOR : DEFAULT_CATEGORY_COLOR;
}
