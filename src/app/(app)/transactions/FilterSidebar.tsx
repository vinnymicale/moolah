"use client";

import { useState } from "react";
import { Check, ChevronDown, ChevronRight, SlidersHorizontal, X } from "lucide-react";
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
 * Every transaction filter as a collapsible checklist, pinned beside the table.
 * A fixed column rather than a popover: selecting an option navigates and
 * re-renders, which used to reposition (and close) the old dropdown after every
 * click. An empty selection in a group means "all" - no filtering on that group.
 *
 * `onClearAll` is required rather than derived from the groups: clearing them
 * one at a time fires a navigation per group, and each is built from the params
 * of the current render, so all but the last would be overwritten.
 */
export function FilterSidebar({
  groups,
  onClearAll,
  dateRange,
}: {
  groups: FilterGroup[];
  onClearAll: () => void;
  /** The date-range controls, pinned above the checklists as the first filter. */
  dateRange?: React.ReactNode;
}) {
  // Every section starts open; long lists scroll inside their own section
  // instead of pushing the rest of the column off screen.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  // Below md the column stacks above the list, so it collapses to a summary bar.
  const [openOnMobile, setOpenOnMobile] = useState(false);

  const toggleOption = (group: FilterGroup, value: string) => {
    const next = new Set(group.selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    group.onChange(next);
  };
  const toggleSection = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const totalSelected = groups.reduce((sum, g) => sum + g.selected.size, 0);

  return (
    <aside className="w-full shrink-0 md:w-56">
      <div className="card md:sticky md:top-4">
        <div className="flex items-center gap-2 border-b border-line px-3 py-2">
          <SlidersHorizontal size={14} className="shrink-0 text-muted" />
          <span className="flex-1 text-sm font-medium">Filters</span>
          {totalSelected > 0 && (
            <button
              type="button"
              onClick={onClearAll}
              className="flex items-center gap-1 text-xs text-muted hover:text-text"
              title="Clear every filter"
            >
              <X size={12} /> Clear
            </button>
          )}
          <button
            type="button"
            onClick={() => setOpenOnMobile((o) => !o)}
            className="btn-ghost h-7 w-7 p-0! md:hidden"
            aria-expanded={openOnMobile}
            aria-label={openOnMobile ? "Hide filters" : "Show filters"}
          >
            <ChevronDown size={14} className={`transition-transform ${openOnMobile ? "rotate-180" : ""}`} />
          </button>
        </div>

        <div className={`${openOnMobile ? "block" : "hidden"} max-h-[70vh] overflow-y-auto p-1 md:block md:max-h-[calc(100vh-8rem)]`}>
          {dateRange && (
            <div className="border-b border-line px-2 pb-2 pt-1">
              <p className="pb-1.5 text-xs font-medium text-muted">Date range</p>
              {dateRange}
            </div>
          )}
          {groups.map((group) => {
            const isOpen = !collapsed.has(group.key);
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
                  <ul className="max-h-44 overflow-y-auto pb-1">
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
        </div>
      </div>
    </aside>
  );
}
