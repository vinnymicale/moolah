"use client";

import { Plus, X } from "lucide-react";
import type { CategoryDTO } from "@/lib/queries";
import { toCents } from "@/lib/money";

export interface SplitRow {
  categoryId: string;
  amount: string;
}

export const EMPTY_SPLITS: SplitRow[] = [
  { categoryId: "", amount: "" },
  { categoryId: "", amount: "" },
];

interface SplitEditorProps {
  /** Category options for the current transaction type (kind-filtered). */
  categories: CategoryDTO[];
  /** Transaction total in dollars, used to compute the unallocated remainder. */
  total: number;
  rows: SplitRow[];
  onChange: (rows: SplitRow[]) => void;
}

export function SplitEditor({ categories, total, rows, onChange }: SplitEditorProps) {
  const totalCents = toCents(total);
  const allocatedCents = rows.reduce((sum, s) => sum + toCents(s.amount), 0);
  const remainingCents = totalCents - allocatedCents;

  const update = (i: number, patch: Partial<SplitRow>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { categoryId: "", amount: "" }]);
  const remove = (i: number) =>
    onChange(rows.length <= 2 ? rows : rows.filter((_, idx) => idx !== i));

  // Drop the leftover (or overage) onto the last part so the split lands on an
  // exact total - handles the 33.33/33.33/33.34 penny problem in one click.
  const distributeRemainder = () => {
    if (rows.length === 0) return;
    const last = rows.length - 1;
    const lastCents = toCents(rows[last].amount) + remainingCents;
    if (lastCents <= 0) return;
    onChange(rows.map((r, idx) => (idx === last ? { ...r, amount: (lastCents / 100).toFixed(2) } : r)));
  };

  return (
    <div className="rounded-lg border border-line p-3 space-y-2">
      {rows.map((s, i) => (
        <div key={i} className="flex items-center gap-2">
          <select
            className="input flex-1"
            value={s.categoryId}
            onChange={(e) => update(i, { categoryId: e.target.value })}
          >
            <option value="">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <div className="relative w-28">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-muted">$</span>
            <input
              className="input pl-6"
              inputMode="decimal"
              value={s.amount}
              onChange={(e) => update(i, { amount: e.target.value })}
              placeholder="0.00"
            />
          </div>
          <button
            type="button"
            onClick={() => remove(i)}
            disabled={rows.length <= 2}
            className="btn-ghost px-2 disabled:opacity-30"
            title="Remove part"
          >
            <X size={14} />
          </button>
        </div>
      ))}
      <div className="flex items-center justify-between pt-1">
        <button type="button" onClick={add} className="btn-ghost text-xs">
          <Plus size={14} /> Add part
        </button>
        <div className="flex items-center gap-2">
          {remainingCents !== 0 && totalCents > 0 && (
            <button
              type="button"
              onClick={distributeRemainder}
              className="text-xs text-brand hover:underline"
              title="Apply the leftover to the last part"
            >
              Distribute
            </button>
          )}
          <span className={`text-xs ${remainingCents === 0 ? "text-muted" : "text-expense"}`}>
            {remainingCents === 0
              ? "Fully allocated"
              : `${remainingCents > 0 ? "Unallocated" : "Over by"} $${(Math.abs(remainingCents) / 100).toFixed(2)}`}
          </span>
        </div>
      </div>
    </div>
  );
}
