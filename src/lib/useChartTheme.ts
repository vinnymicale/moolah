"use client";

import { useSyncExternalStore } from "react";
import { CHART_TOKEN_FALLBACKS, resolveChartTheme, type ChartTheme } from "./chart-theme";

// Resolve chart colors from the live design tokens so recharts re-themes when
// the user flips light/dark. We read the tokens off <html> and re-resolve when
// its class attribute changes (that's how dark mode is toggled).

function read(token: string): string {
  if (typeof window === "undefined") return "";
  return getComputedStyle(document.documentElement).getPropertyValue(token);
}

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => obs.disconnect();
}

// Cache the snapshot so useSyncExternalStore gets a stable reference between
// renders (it bails out of updates only if the returned value is identical).
let cached: ChartTheme = CHART_TOKEN_FALLBACKS;
let cacheKey = "";

function getSnapshot(): ChartTheme {
  const next = resolveChartTheme(read);
  const key = `${next.axis}|${next.grid}|${next.income}|${next.expense}|${next.brand}`;
  if (key !== cacheKey) {
    cached = next;
    cacheKey = key;
  }
  return cached;
}

function getServerSnapshot(): ChartTheme {
  return CHART_TOKEN_FALLBACKS;
}

export function useChartTheme(): ChartTheme {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
