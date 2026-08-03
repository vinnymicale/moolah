"use client";

import { useState, useTransition } from "react";
import { Check } from "lucide-react";
import { updateMinCheckingFloorAction } from "@/actions/settings";

const DEFAULT_FLOOR = 500;

export function MinCheckingFloorForm({ currentFloor }: { currentFloor: number | null }) {
  const [value, setValue] = useState(String(currentFloor ?? DEFAULT_FLOOR));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const floor = Number(value);
      const res = await updateMinCheckingFloorAction(Number.isFinite(floor) ? floor : NaN);
      if (!res.ok) {
        setError(res.error ?? "Failed to save.");
        return;
      }
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  const reset = () =>
    start(async () => {
      setError(null);
      const res = await updateMinCheckingFloorAction(null);
      if (!res.ok) {
        setError(res.error ?? "Failed to save.");
        return;
      }
      setValue(String(DEFAULT_FLOOR));
      setSaved(true);
      setTimeout(() => setSaved(false), 1500);
    });

  return (
    <div className="space-y-3">
      <div className="w-40">
        <label className="label">Minimum checking balance</label>
        <div className="relative">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
          <input
            className="input pl-6"
            type="number"
            min={0}
            step={50}
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </div>
      </div>
      {error && <p className="text-xs text-expense">{error}</p>}
      <div className="flex items-center gap-2">
        <button onClick={save} disabled={pending} className="btn-primary">
          {saved ? <Check size={16} /> : null}
          {pending ? "Saving…" : saved ? "Saved" : "Save"}
        </button>
        {currentFloor !== null && (
          <button onClick={reset} disabled={pending} className="btn-ghost">
            Reset to default (${DEFAULT_FLOOR})
          </button>
        )}
      </div>
      <p className="text-xs text-muted">
        &quot;Safe to transfer&quot; will never recommend an amount that would leave your checking
        accounts below this. Defaults to ${DEFAULT_FLOOR}.
      </p>
    </div>
  );
}
