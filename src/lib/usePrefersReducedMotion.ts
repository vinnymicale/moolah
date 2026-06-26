"use client";

import { useSyncExternalStore } from "react";

// Tracks the OS "reduce motion" setting so JS-driven animation (e.g. recharts
// entrance draws) can be disabled to match the CSS @media rule in globals.css.

const QUERY = "(prefers-reduced-motion: reduce)";

function subscribe(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const mql = window.matchMedia(QUERY);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

function getSnapshot(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return false;
  return window.matchMedia(QUERY).matches;
}

export function usePrefersReducedMotion(): boolean {
  // Server renders with motion enabled (false) to match the default client paint.
  return useSyncExternalStore(subscribe, getSnapshot, () => false);
}
