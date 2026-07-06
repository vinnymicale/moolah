"use client";

// Suggested-budget flow: fetches per-category suggestions computed from
// recurring charges, lets the user pick categories, tweak amounts, and
// exclude individual charges, then batch-applies the result.

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

/** Sum a category's included charges, rounded up to a whole dollar. */
function computeSuggested(cat: SuggestedCategoryDTO, excluded: Set<string>): number {
  const cents = cat.items.reduce((s, i) => (excluded.has(i.id) ? s : s + toCents(i.monthlyAmount)), 0);
  return Math.ceil(cents / 100);
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
  const [applyPending, startApply] = useTransition();

  useEffect(() => {
    let cancelled = false;
    getBudgetSuggestionsAction({ month: monthISO }).then((res) => {
      if (cancelled) return;
      setLoading(false);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setCategories(res.data.categories);
      setUncategorizedCount(res.data.uncategorizedCount);
      // Categories that already have a limit default to keeping it.
      setRows(
        new Map(
          res.data.categories.map((c) => [
            c.categoryId,
            {
              checked: c.currentLimit <= 0,
              amount: String(c.suggested),
              edited: false,
              excluded: new Set<string>(),
              expanded: false,
            },
          ]),
        ),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [monthISO]);

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
        amount: row.edited ? row.amount : String(computeSuggested(cat, excluded)),
      });
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

  const apply = () =>
    startApply(async () => {
      setError(null);
      const res = await applyBudgetSuggestionsAction({ month: monthISO, entries });
      if (res.ok) onClose();
      else setError(res.error);
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

  return (
    <>
      <p className="mb-3 text-xs text-muted">
            Based on your recurring rules and charges detected in the last 12 months. Check the categories to
            apply, adjust amounts, or expand a category to exclude specific charges.
          </p>
          <ul className="max-h-[50vh] divide-y divide-line overflow-x-hidden overflow-y-auto rounded-xl border border-line">
            {categories.map((c) => {
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
                        {c.items.length} recurring charge{c.items.length === 1 ? "" : "s"}
                        {c.currentLimit > 0 && (
                          <span className="ml-1">· current {formatUSD(c.currentLimit)}</span>
                        )}
                      </button>
                    </div>
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
                              {item.description}
                            </span>
                            <span className="hidden shrink-0 text-muted sm:inline">{item.cadence}</span>
                            <span className="money shrink-0 text-right">{formatUSD(item.monthlyAmount)}/mo</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
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
