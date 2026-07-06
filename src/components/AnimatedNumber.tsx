"use client";

import { useEffect, useRef, useState } from "react";
import { formatUSD } from "@/lib/money";

const DURATION_MS = 650;

/**
 * Counts up from zero to `value` on first mount. The server (and reduced
 * motion) render the final figure, so the number is always correct without JS.
 */
export function AnimatedNumber({ value, format = "usd" }: { value: number; format?: "usd" | "percent" }) {
  const [display, setDisplay] = useState(value);
  const animated = useRef(false);

  useEffect(() => {
    if (animated.current || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      animated.current = true;
      setDisplay(value);
      return;
    }
    animated.current = true;
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / DURATION_MS);
      const eased = 1 - Math.pow(1 - t, 3);
      setDisplay(value * eased);
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);

  return <>{format === "percent" ? `${Math.round(display)}%` : formatUSD(display)}</>;
}
