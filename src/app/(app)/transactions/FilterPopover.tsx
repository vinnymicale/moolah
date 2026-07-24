"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";

export interface MultiOption {
  value: string;
  label: string;
  color?: string;
  icon?: string;
}

export interface FilterGroup {
  key: string;
  label: string;
  options: MultiOption[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}

/**
 * A single popover holding every transaction filter as a collapsible checklist
 * section. Keeps the toolbar to one control so it never wraps. An empty
 * selection in a group means "all" (no filtering on that group).
 */
export function FilterPopover({ groups }: { groups: FilterGroup[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // Sections start expanded only where a filter is already active.
  const [expanded, setExpanded] = useState<Set<string>>(
    () => new Set(groups.filter((g) => g.selected.size > 0).map((g) => g.key)),
  );

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

  const toggleOption = (group: FilterGroup, value: string) => {
    const next = new Set(group.selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    group.onChange(next);
  };
  const toggleSection = (key: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const totalSelected = groups.reduce((sum, g) => sum + g.selected.size, 0);
  const clearAll = () => groups.forEach((g) => g.selected.size > 0 && g.onChange(new Set()));

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`input flex h-9 w-auto items-center gap-1.5 text-sm ${totalSelected > 0 ? "border-brand/50 text-text" : "text-muted"}`}
        aria-expanded={open}
      >
        <span>Filters</span>
        {totalSelected > 0 && (
          <span className="flex h-4 min-w-4 items-center justify-center rounded-full bg-brand px-1 text-[10px] font-semibold text-brand-fg">
            {totalSelected}
          </span>
        )}
        <ChevronDown size={14} className={`shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-[70vh] w-64 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
          {groups.map((group) => {
            const isOpen = expanded.has(group.key);
            return (
              <div key={group.key} className="border-b border-line last:border-b-0">
                <button
                  type="button"
                  onClick={() => toggleSection(group.key)}
                  className="flex w-full items-center gap-1.5 px-2 py-2 text-left text-xs font-medium text-muted hover:text-text"
                >
                  {isOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  <span className="flex-1">{group.label}</span>
                  {group.selected.size > 0 && (
                    <span className="text-[10px] text-brand">{group.selected.size}</span>
                  )}
                </button>
                {isOpen && (
                  <ul className="pb-1">
                    {group.options.map((o) => {
                      const checked = group.selected.has(o.value);
                      return (
                        <li key={o.value}>
                          <button
                            type="button"
                            onClick={() => toggleOption(group, o.value)}
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
                )}
              </div>
            );
          })}
          {totalSelected > 0 && (
            <div className="flex justify-end px-2 py-1.5">
              <button type="button" onClick={clearAll} className="text-xs text-brand hover:underline">
                Clear all
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
