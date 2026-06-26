"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// Decide what a click on an arm-then-confirm button should do, given whether
// it's currently armed. Pure so it can be tested without a DOM: "run" fires the
// action, "arm" shows the confirm prompt. Kept separate from the hook below.
export function nextConfirmStep(armed: boolean): "run" | "arm" {
  return armed ? "run" : "arm";
}

// A lightweight two-click guard for destructive buttons: the first click arms
// the action (the button relabels to "Click to confirm"), the second runs it.
// The armed state disarms itself after `timeoutMs` so a stale confirm doesn't
// linger. Keeps irreversible deletes from firing on a single stray click
// without pulling in a modal-on-a-modal.
export function useConfirmAction(action: () => void, timeoutMs = 3000) {
  const [armed, setArmed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  const trigger = useCallback(() => {
    if (nextConfirmStep(armed) === "run") {
      clear();
      setArmed(false);
      action();
      return;
    }
    setArmed(true);
    timer.current = setTimeout(() => setArmed(false), timeoutMs);
  }, [armed, action, clear, timeoutMs]);

  useEffect(() => clear, [clear]);

  return { armed, trigger };
}
