"use client";

// Suggested-budget flow: fetches per-category suggestions computed from
// recurring charges, lets the user pick categories, tweak amounts, and
// exclude individual charges, then batch-applies the result. Categories are
// grouped into a fixed-cost "Recurring" section and a "Variable spending"
// section (anything driven by typical-spend medians).

import { useCallback, useEffect, useMemo, useState, useTransition } from "react";
import { ChevronDown, ChevronRight, Loader2, Sparkles } from "lucide-react";
import { Modal } from "@/components/Modal";
import { CategoryIcon } from "@/components/CategoryIcon";
import { formatUSD, toCents } from "@/lib/money";
import { getBudgetSuggestionsAction, applyBudgetSuggestionsAction } from "@/actions/budget-suggestions";
import type { SuggestedCategoryDTO } from "@/lib/budget-suggestions";

interface RowState {
  /** Whether this category will be applied. */
  checked: boolean;
  /** Amount input value (string so the user can type freely). */
  amount: string;
  /** Once the user edits the amount, charge toggles stop recomputing it. */
  edited: boolean;
  /** Charge ids excluded from the computation. */
  excluded: Set<string>;
  expanded: boolean;
}

/** Sum a category's included charges, rounded up to the rounding step. */
function computeSuggested(cat: SuggestedCategoryDTO, excluded: Set<string>, step: number): number {
  const cents = cat.items.reduce((s, i) => (excluded.has(i.id) ? s : s + toCents(i.monthlyAmount)), 0);
  return Math.ceil(cents / 100 / step) * step;
}

// Saved per-category choices, so reopening the modal keeps checkbox, amount,
// and exclusion tweaks. Keyed by month; cleared once suggestions are applied.
interface SavedRow {
  checked: boolean;
  amount: string;
  edited: boolean;
  excluded: string[];
}

const storageKey = (monthISO: string) => `moolah.budgetSuggest.${monthISO}`;
const ROUNDING_KEY = "moolah.budgetSuggest.rounding";
const ROUNDING_STEPS = [1, 5, 10] as const;

function loadSavedRows(monthISO: string): Record<string, SavedRow> {
  try {
    return JSON.parse(localStorage.getItem(storageKey(monthISO)) ?? "{}") as Record<string, SavedRow>;
  } catch {
    return {};
  }
}

function loadRounding(): number {
  try {
    const n = Number(localStorage.getItem(ROUNDING_KEY));
    return ROUNDING_STEPS.includes(n as (typeof ROUNDING_STEPS)[number]) ? n : 1;
  } catch {
    return 1;
  }
}

/** Tiny 6-month spend trend; renders nothing when there is no history. */
function Sparkline({ totals, color }: { totals: number[]; color: string }) {
  const max = Math.max(...totals);
  if (max <= 0) return null;
  const w = 52;
  const h = 18;
  const step = w / (totals.length - 1);
  const points = totals.map((t, i) => `${(i * step).toFixed(1)},${(h - 2 - (t / max) * (h - 4)).toFixed(1)}`).join(" ");
  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="hidden shrink-0 sm:block"
      aria-hidden="true"
    >
      <title>Last 6 months of spending</title>
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" strokeLinecap="round" opacity="0.75" />
    </svg>
  );
}

export function SuggestBudgetModal({
  open,
  onClose,
  monthISO,
  monthTitle,
}: {
  open: boolean;
  onClose: () => void;
  monthISO: string;
  monthTitle: string;
}) {
  return (
    <Modal open={open} onClose={onClose} title={`Suggested budget · ${monthTitle}`} widthClass="max-w-xl">
      {/* Modal renders nothing when closed, so this remounts (and refetches) each open. */}
      {open && <SuggestContent onClose={onClose} monthISO={monthISO} />}
    </Modal>
  );
}

function SuggestContent({ onClose, monthISO }: { onClose: () => void; monthISO: string }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [categories, setCategories] = useState<SuggestedCategoryDTO[]>([]);
  const [uncategorizedCount, setUncategorizedCount] = useState(0);
  const [rows, setRows] = useState<Map<string, RowState>>(new Map());
  // Lazy init: content only mounts client-side (modal open), and loadRounding
  // falls back to $1 anywhere localStorage is unavailable.
  const [rounding, setRounding] = useState(loadRounding);
  const [applyPending, startApply] = useTransition();

  useEffect(() => {
    let cancelled = false;
    const step = loadRounding();
    getBudgetSuggestionsAction({ month: monthISO }).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCategories(res.data.categories);
      setUncategorizedCount(res.data.uncategorizedCount);
      // Defaults: categories with an existing limit keep it (unchecked), and
      // stale charges start excluded. Saved choices from a previous open of
      // this month's modal override the defaults.
      const saved = loadSavedRows(monthISO);
      setRows(
        new Map(
          res.data.categories.map((c) => {
            const s = saved[c.categoryId];
            const row: RowState = s
              ? {
                  checked: s.checked,
                  amount: s.amount,
                  edited: s.edited,
                  excluded: new Set(s.excluded.filter((id) => c.items.some((i) => i.id === id))),
                  expanded: false,
                }
              : {
                  checked: c.currentLimit <= 0,
                  amount: String(computeSuggested(c, new Set(c.items.filter((i) => i.stale).map((i) => i.id)), step)),
                  edited: false,
                  excluded: new Set(c.items.filter((i) => i.stale).map((i) => i.id)),
                  expanded: false,
                };
            return [c.categoryId, row];
          }),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [monthISO]);

  // Remember choices for this month across modal opens.
  useEffect(() => {
    if (loading || rows.size === 0) return;
    const out: Record<string, SavedRow> = {};
    for (const [id, r] of rows) {
      out[id] = { checked: r.checked, amount: r.amount, edited: r.edited, excluded: [...r.excluded] };
    }
    try {
      localStorage.setItem(storageKey(monthISO), JSON.stringify(out));
    } catch {
      // Storage unavailable; persistence is best-effort.
    }
  }, [rows, loading, monthISO]);

  const updateRow = useCallback((categoryId: string, patch: Partial<RowState>) => {
    setRows((prev) => {
      const next = new Map(prev);
      const row = next.get(categoryId);
      if (row) next.set(categoryId, { ...row, ...patch });
      return next;
    });
  }, []);

  const toggleCharge = (cat: SuggestedCategoryDTO, chargeId: string) => {
    setRows((prev) => {
      const next = new Map(prev);
      const row = next.get(cat.categoryId);
      if (!row) return prev;
      const excluded = new Set(row.excluded);
      if (excluded.has(chargeId)) excluded.delete(chargeId);
      else excluded.add(chargeId);
      next.set(cat.categoryId, {
        ...row,
        excluded,
        // A manual edit sticks; otherwise track the recomputed total.
        amount: row.edited ? row.amount : String(computeSuggested(cat, excluded, rounding)),
      });
      return next;
    });
  };

  const changeRounding = (step: number) => {
    setRounding(step);
    try {
      localStorage.setItem(ROUNDING_KEY, String(step));
    } catch {
      // Best-effort.
    }
    // Re-round every amount the user hasn't hand-edited.
    setRows((prev) => {
      const next = new Map(prev);
      for (const c of categories) {
        const row = next.get(c.categoryId);
        if (!row || row.edited) continue;
        next.set(c.categoryId, { ...row, amount: String(computeSuggested(c, row.excluded, step)) });
      }
      return next;
    });
  };

  const entries = useMemo(() => {
    const out: { categoryId: string; limit: number }[] = [];
    for (const c of categories) {
      const row = rows.get(c.categoryId);
      if (!row?.checked) continue;
      const limit = Number(row.amount.replace(/[^0-9.]/g, ""));
      if (limit > 0) out.push({ categoryId: c.categoryId, limit });
    }
    return out;
  }, [categories, rows]);

  // Coverage check: what the selected budgets total, versus what these same
  // categories actually cost last month.
  const coverage = useMemo(() => {
    let budgetCents = 0;
    let actualCents = 0;
    for (const c of categories) {
      const row = rows.get(c.categoryId);
      if (!row?.checked) continue;
      const limit = Number(row.amount.replace(/[^0-9.]/g, ""));
      if (!(limit > 0)) continue;
      budgetCents += toCents(limit);
      actualCents += toCents(c.recentTotals[c.recentTotals.length - 1] ?? 0);
    }
    return { budgetCents, actualCents };
  }, [categories, rows]);

  const apply = () =>
    startApply(async () => {
      setError(null);
      const res = await applyBudgetSuggestionsAction({ month: monthISO, entries });
      if (res.ok) {
        localStorage.removeItem(storageKey(monthISO));
        onClose();
      } else setError(res.error);
    });

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted">
        <Loader2 size={16} className="animate-spin" /> Analyzing recurring charges…
      </div>
    );
  }

  if (error && categories.length === 0) {
    return <p className="py-8 text-center text-sm text-expense">{error}</p>;
  }

  if (categories.length === 0) {
    return (
      <div className="py-10 text-center">
        <Sparkles size={20} className="mx-auto mb-2 text-muted" />
        <p className="text-sm text-muted">No recurring expenses found to base a budget on.</p>
        <p className="mt-1 text-xs text-muted">Add recurring rules or import more history, then try again.</p>
      </div>
    );
  }

  // Categories whose suggestion includes typical variable spending sit in
  // their own section; everything else is purely recurring charges.
  const recurringCats = categories.filter((c) => !c.items.some((i) => i.source === "typical"));
  const variableCats = categories.filter((c) => c.items.some((i) => i.source === "typical"));
  const sections = [
    { label: "Recurring", hint: "fixed bills & subscriptions", cats: recurringCats },
    { label: "Variable spending", hint: "based on recent months", cats: variableCats },
  ].filter((s) => s.cats.length > 0);

  const renderCategory = (c: SuggestedCategoryDTO) => {
    const row = rows.get(c.categoryId);
    if (!row) return null;
    return (
      <li key={c.categoryId} className="px-3 py-2.5">
        <div className="flex items-center gap-2.5">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-brand"
            checked={row.checked}
            onChange={(e) => updateRow(c.categoryId, { checked: e.target.checked })}
            aria-label={`Apply budget for ${c.name}`}
          />
          <span
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
            style={{ backgroundColor: `${c.color}22`, color: c.color }}
          >
            <CategoryIcon name={c.icon} size={15} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium">{c.name}</p>
            <button
              type="button"
              onClick={() => updateRow(c.categoryId, { expanded: !row.expanded })}
              className="flex items-center gap-0.5 text-xs text-muted hover:text-text"
            >
              {row.expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              {c.items.length} charge{c.items.length === 1 ? "" : "s"}
              {c.currentLimit > 0 && <span className="ml-1">· current {formatUSD(c.currentLimit)}</span>}
            </button>
          </div>
          <Sparkline totals={c.recentTotals} color={c.color} />
          <div className="relative w-24 shrink-0">
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-sm text-muted">$</span>
            <input
              className="input h-9 pl-6 pr-2 text-right money"
              inputMode="decimal"
              value={row.amount}
              onChange={(e) => updateRow(c.categoryId, { amount: e.target.value, edited: true })}
              disabled={!row.checked}
              aria-label={`Budget amount for ${c.name}`}
            />
          </div>
        </div>
        {row.expanded && (
          <ul className="mt-2 space-y-1 pl-9 sm:pl-14">
            {c.items.map((item) => (
              <li key={item.id}>
                <label className="flex cursor-pointer items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 shrink-0 accent-brand"
                    checked={!row.excluded.has(item.id)}
                    onChange={() => toggleCharge(c, item.id)}
                  />
                  <span className={`min-w-0 flex-1 truncate ${row.excluded.has(item.id) ? "text-muted line-through" : ""}`}>
                    {item.source === "typical" ? (
                      item.description
                    ) : (
                      <a
                        href={`/transactions?q=${encodeURIComponent(item.description)}`}
                        target="_blank"
                        rel="noreferrer"
                        className="hover:text-brand hover:underline"
                        title={`View ${item.description} transactions`}
                      >
                        {item.description}
                      </a>
                    )}
                    {item.stale && (
                      <span className="ml-1.5 rounded bg-warning/15 px-1 py-0.5 text-[10px] font-medium text-warning no-underline">
                        possibly ended
                      </span>
                    )}
                  </span>
                  <span className="hidden shrink-0 text-muted sm:inline">{item.cadence}</span>
                  <span className="money shrink-0 text-right">{formatUSD(item.monthlyAmount)}/mo</span>
                </label>
                {item.topExpenses && item.topExpenses.length > 0 && (
                  <ul className="mt-1 space-y-0.5 border-l border-line pl-4 ml-1.5">
                    <li className="text-[10px] uppercase tracking-wide text-muted/80">
                      Top expenses · last 6 months
                    </li>
                    {item.topExpenses.map((e) => (
                      <li key={e.description} className="flex items-center gap-2 text-[11px] text-muted">
                        <a
                          href={`/transactions?q=${encodeURIComponent(e.description)}`}
                          target="_blank"
                          rel="noreferrer"
                          className="min-w-0 flex-1 truncate hover:text-brand hover:underline"
                          title={`View ${e.description} transactions`}
                        >
                          {e.description}
                        </a>
                        <span className="shrink-0">
                          {e.count} purchase{e.count === 1 ? "" : "s"}
                        </span>
                        <span className="money shrink-0 text-right text-text/80">{formatUSD(e.total)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        )}
      </li>
    );
  };

  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-xs text-muted">
          Based on your recurring rules and charges detected in the last 12 months. Check the categories to
          apply, adjust amounts, or expand a category to exclude specific charges.
        </p>
        <div className="flex shrink-0 items-center gap-1" role="group" aria-label="Round suggestions to">
          <span className="mr-0.5 text-xs text-muted">Round</span>
          {ROUNDING_STEPS.map((step) => (
            <button
              key={step}
              type="button"
              onClick={() => changeRounding(step)}
              aria-pressed={rounding === step}
              className={`rounded-md border px-1.5 py-0.5 text-xs ${
                rounding === step
                  ? "border-brand bg-brand/10 font-medium text-brand"
                  : "border-line text-muted hover:text-text"
              }`}
            >
              ${step}
            </button>
          ))}
        </div>
      </div>
      <div className="max-h-[50vh] divide-y divide-line overflow-x-hidden overflow-y-auto rounded-xl border border-line">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="sticky top-0 z-10 flex items-baseline gap-2 border-b border-line bg-surface px-3 py-1.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted">{section.label}</span>
              <span className="text-[10px] text-muted">{section.hint}</span>
            </div>
            <ul className="divide-y divide-line">{section.cats.map(renderCategory)}</ul>
          </div>
        ))}
      </div>
      {coverage.actualCents > 0 && (
        <p className="mt-2 text-xs text-muted">
          Selected budgets total <span className="money text-text">{formatUSD(coverage.budgetCents / 100)}</span>
          {" — "}last month these categories cost{" "}
          <span className="money text-text">{formatUSD(coverage.actualCents / 100)}</span> (
          {Math.round((coverage.budgetCents / coverage.actualCents) * 100)}% covered).
        </p>
      )}
      {uncategorizedCount > 0 && (
        <p className="mt-2 text-xs text-muted">
          {uncategorizedCount} recurring charge{uncategorizedCount === 1 ? " wasn't" : "s weren't"} included
          because {uncategorizedCount === 1 ? "it has" : "they have"} no category.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-expense">{error}</p>}
      <div className="mt-4 flex items-center justify-end gap-2">
        <button onClick={onClose} className="btn-ghost h-9 text-sm">
          Cancel
        </button>
        <button onClick={apply} disabled={applyPending || entries.length === 0} className="btn-primary h-9 text-sm">
          {applyPending ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />}
          Apply
        </button>
      </div>
    </>
  );
}
