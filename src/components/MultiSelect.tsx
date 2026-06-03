"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";

export interface MultiOption {
  value: string;
  label: string;
  color?: string;
  icon?: string;
}

/**
 * A filter control that lets the user pick any number of options via
 * checkboxes. An empty selection means "all" (no filtering). The trigger shows
 * the active count so the toolbar stays compact.
 */
export function MultiSelect({
  label,
  allLabel,
  options,
  selected,
  onChange,
}: {
  label: string;
  /** Text shown on the trigger when nothing is selected (defaults to label). */
  allLabel?: string;
  options: MultiOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const toggle = (value: string) => {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  };

  const count = selected.size;
  const triggerLabel =
    count === 0
      ? allLabel ?? label
      : count === 1
      ? options.find((o) => o.value === [...selected][0])?.label ?? `${label}: 1`
      : `${label}: ${count}`;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`input flex h-9 w-auto items-center gap-1.5 text-sm ${count > 0 ? "border-brand/50 text-text" : "text-muted"}`}
        aria-expanded={open}
      >
        <span className="max-w-40 truncate">{triggerLabel}</span>
        {count > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-fg">
            {count}
          </span>
        )}
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
          <div className="flex items-center justify-between px-2 py-1">
            <span className="text-xs font-medium text-muted">{label}</span>
            {count > 0 && (
              <button onClick={() => onChange(new Set())} className="text-xs text-brand hover:underline">
                Clear
              </button>
            )}
          </div>
          <ul>
            {options.map((o) => {
              const checked = selected.has(o.value);
              return (
                <li key={o.value}>
                  <button
                    type="button"
                    onClick={() => toggle(o.value)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface2"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? "border-brand bg-brand text-brand-fg" : "border-line"
                      }`}
                    >
                      {checked && <Check size={11} />}
                    </span>
                    {o.color && (
                      <span
                        className="flex h-5 w-5 shrink-0 items-center justify-center rounded"
                        style={{ backgroundColor: `${o.color}22`, color: o.color }}
                      >
                        {o.icon ? <CategoryIcon name={o.icon} size={12} /> : <span className="h-2 w-2 rounded-full" style={{ background: o.color }} />}
                      </span>
                    )}
                    <span className="flex-1 truncate">{o.label}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
