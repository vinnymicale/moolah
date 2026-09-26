"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, X } from "lucide-react";
import { Modal } from "@/components/Modal";
import { REWARD_CATEGORIES, type RewardCategoryKey } from "@/lib/card-rewards/categories";
import { currentQuarter } from "@/lib/card-rewards/rank";
import type { CapPeriod, RewardCurrency, RewardProfileInput } from "@/lib/card-rewards/types";
import type { RewardProfileDTO } from "@/lib/queries/card-rewards";
import { updateRewardProfileAction } from "@/actions/card-rewards";

type RuleRow = { category: RewardCategoryKey; rate: string; capAmount: string; capPeriod: CapPeriod };
type QuarterRow = { year: string; quarter: 1 | 2 | 3 | 4; categories: RewardCategoryKey[] };

type Props = {
  open: boolean;
  onClose: () => void;
  cardName: string;
  profile: RewardProfileDTO;
};

function initialState(p: RewardProfileDTO) {
  return {
    currency: p.currency,
    programName: p.programName ?? "",
    centsPerPoint: String(p.centsPerPoint),
    baseRate: String(p.baseRate),
    rules: p.rules.map<RuleRow>((r) => ({
      category: r.category,
      rate: String(r.rate),
      capAmount: r.cap ? String(r.cap.amount) : "",
      capPeriod: r.cap?.period ?? "YEAR",
    })),
    hasRotating: p.rotating !== null,
    rotatingRate: String(p.rotating?.rate ?? 5),
    rotatingCap: String(p.rotating?.capAmount ?? 1500),
    quarters: (p.rotating?.quarters ?? []).map<QuarterRow>((q) => ({
      year: String(q.year),
      quarter: q.quarter,
      categories: q.categories,
    })),
  };
}

export function RewardsEditorModal({ open, onClose, cardName, profile }: Props) {
  const router = useRouter();
  const [form, setForm] = useState(() => initialState(profile));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));
  const setRule = (i: number, patch: Partial<RuleRow>) =>
    set("rules", form.rules.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const setQuarter = (i: number, patch: Partial<QuarterRow>) =>
    set("quarters", form.quarters.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  const unused = REWARD_CATEGORIES.find((c) => !form.rules.some((r) => r.category === c.key));

  const addQuarter = () => {
    const last = form.quarters.at(-1);
    const base = last ? { year: Number(last.year), quarter: last.quarter } : currentQuarter(new Date());
    const next = last
      ? base.quarter === 4
        ? { year: base.year + 1, quarter: 1 as const }
        : { year: base.year, quarter: (base.quarter + 1) as 1 | 2 | 3 | 4 }
      : base;
    set("quarters", [...form.quarters, { year: String(next.year), quarter: next.quarter, categories: [] }]);
  };

  const close = () => {
    setForm(initialState(profile));
    setError(null);
    onClose();
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const input: RewardProfileInput = {
      currency: form.currency,
      programName: form.programName.trim() || null,
      centsPerPoint: form.currency === "CASH" ? 1 : Number(form.centsPerPoint),
      baseRate: Number(form.baseRate),
      rules: form.rules.map((r) => ({
        category: r.category,
        rate: Number(r.rate),
        ...(r.capAmount.trim() ? { cap: { amount: Number(r.capAmount), period: r.capPeriod } } : {}),
      })),
      rotating: form.hasRotating
        ? {
            rate: Number(form.rotatingRate),
            capAmount: Number(form.rotatingCap),
            quarters: form.quarters.map((q) => ({ year: Number(q.year), quarter: q.quarter, categories: q.categories })),
          }
        : null,
    };
    setBusy(true);
    setError(null);
    const r = await updateRewardProfileAction(profile.id, input);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else {
      onClose();
      router.refresh();
    }
  };

  const rateUnit = form.currency === "CASH" ? "%" : "x";

  return (
    <Modal open={open} onClose={close} title={`Rewards for ${cardName}`} widthClass="max-w-2xl">
      <form onSubmit={save} className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <label>
            <span className="label">Earns</span>
            <select
              className="input"
              value={form.currency}
              onChange={(e) => set("currency", e.target.value as RewardCurrency)}
            >
              <option value="CASH">Cash back</option>
              <option value="POINTS">Points</option>
              <option value="MILES">Miles</option>
            </select>
          </label>
          <label>
            <span className="label">Program name</span>
            <input
              className="input"
              value={form.programName}
              onChange={(e) => set("programName", e.target.value)}
              placeholder="Optional"
              maxLength={80}
            />
          </label>
          {form.currency !== "CASH" && (
            <label>
              <span className="label">Cents per {form.currency === "MILES" ? "mile" : "point"}</span>
              <input
                type="number"
                step="0.01"
                min="0.01"
                max="10"
                className="input"
                value={form.centsPerPoint}
                onChange={(e) => set("centsPerPoint", e.target.value)}
                required
              />
            </label>
          )}
          <label>
            <span className="label">Everything else ({rateUnit})</span>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              className="input"
              value={form.baseRate}
              onChange={(e) => set("baseRate", e.target.value)}
              required
            />
          </label>
        </div>

        <fieldset>
          <legend className="label">Bonus categories</legend>
          <div className="space-y-2">
            {form.rules.map((r, i) => (
              <div key={i} className="grid grid-cols-[1fr_5rem_auto] gap-2 sm:grid-cols-[1fr_5rem_7rem_7rem_auto]">
                <select
                  className="input"
                  value={r.category}
                  onChange={(e) => setRule(i, { category: e.target.value as RewardCategoryKey })}
                  aria-label="Category"
                >
                  {REWARD_CATEGORIES.map((c) => (
                    <option key={c.key} value={c.key}>
                      {c.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  max="100"
                  className="input"
                  value={r.rate}
                  onChange={(e) => setRule(i, { rate: e.target.value })}
                  aria-label={`Rate (${rateUnit})`}
                  required
                />
                <button
                  type="button"
                  className="btn-ghost sm:order-last"
                  onClick={() => set("rules", form.rules.filter((_, j) => j !== i))}
                  aria-label="Remove category"
                >
                  <X size={14} aria-hidden />
                </button>
                <input
                  type="number"
                  step="1"
                  min="0"
                  className="input col-span-2 sm:col-span-1"
                  value={r.capAmount}
                  onChange={(e) => setRule(i, { capAmount: e.target.value })}
                  placeholder="Cap $ (optional)"
                  aria-label="Spending cap"
                />
                <select
                  className="input"
                  value={r.capPeriod}
                  onChange={(e) => setRule(i, { capPeriod: e.target.value as CapPeriod })}
                  disabled={!r.capAmount.trim()}
                  aria-label="Cap period"
                >
                  <option value="MONTH">per month</option>
                  <option value="QUARTER">per quarter</option>
                  <option value="YEAR">per year</option>
                </select>
              </div>
            ))}
          </div>
          {unused && (
            <button
              type="button"
              className="btn-ghost mt-2"
              onClick={() =>
                set("rules", [...form.rules, { category: unused.key, rate: "", capAmount: "", capPeriod: "YEAR" }])
              }
            >
              <Plus size={14} aria-hidden /> Add category
            </button>
          )}
        </fieldset>

        <fieldset>
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" checked={form.hasRotating} onChange={(e) => set("hasRotating", e.target.checked)} />
            Rotating quarterly categories
          </label>
          {form.hasRotating && (
            <div className="mt-3 space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <label>
                  <span className="label">Rotating rate ({rateUnit})</span>
                  <input
                    type="number"
                    step="0.1"
                    min="0"
                    max="100"
                    className="input"
                    value={form.rotatingRate}
                    onChange={(e) => set("rotatingRate", e.target.value)}
                    required
                  />
                </label>
                <label>
                  <span className="label">Quarterly cap ($)</span>
                  <input
                    type="number"
                    step="1"
                    min="1"
                    className="input"
                    value={form.rotatingCap}
                    onChange={(e) => set("rotatingCap", e.target.value)}
                    required
                  />
                </label>
              </div>
              {form.quarters.map((q, i) => (
                <div key={i} className="rounded-xl border border-line bg-surface2 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min="2000"
                      max="2100"
                      className="input w-24"
                      value={q.year}
                      onChange={(e) => setQuarter(i, { year: e.target.value })}
                      aria-label="Year"
                      required
                    />
                    <select
                      className="input w-24"
                      value={q.quarter}
                      onChange={(e) => setQuarter(i, { quarter: Number(e.target.value) as 1 | 2 | 3 | 4 })}
                      aria-label="Quarter"
                    >
                      {[1, 2, 3, 4].map((n) => (
                        <option key={n} value={n}>
                          Q{n}
                        </option>
                      ))}
                    </select>
                    <button
                      type="button"
                      className="btn-ghost ml-auto"
                      onClick={() => set("quarters", form.quarters.filter((_, j) => j !== i))}
                      aria-label="Remove quarter"
                    >
                      <X size={14} aria-hidden />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
                    {REWARD_CATEGORIES.map((c) => (
                      <label key={c.key} className="flex items-center gap-1.5 text-sm">
                        <input
                          type="checkbox"
                          checked={q.categories.includes(c.key)}
                          onChange={(e) =>
                            setQuarter(i, {
                              categories: e.target.checked
                                ? [...q.categories, c.key]
                                : q.categories.filter((k) => k !== c.key),
                            })
                          }
                        />
                        {c.label}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
              <button type="button" className="btn-ghost" onClick={addQuarter}>
                <Plus size={14} aria-hidden /> Add quarter
              </button>
            </div>
          )}
        </fieldset>

        {error && <p className="text-sm text-expense">{error}</p>}

        <div className="flex justify-end gap-2">
          <button type="button" className="btn-ghost" onClick={close} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? "Saving..." : "Save"}
          </button>
        </div>
      </form>
    </Modal>
  );
}
