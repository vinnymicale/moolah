"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveRetirementPlanAction } from "@/actions/retirement";
import { formatUSDWhole } from "@/lib/money";
import type { RetirementAssumptions } from "@/lib/retirement-types";

export function AssumptionsPanel({ assumptions }: { assumptions: RetirementAssumptions }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [birthYear, setBirthYear] = useState(String(assumptions.birthYear));
  const [targetRetirementAge, setTargetRetirementAge] = useState(
    String(assumptions.targetRetirementAge),
  );
  const [expectedReturn, setExpectedReturn] = useState(String(assumptions.expectedReturn));
  const [inflationRate, setInflationRate] = useState(String(assumptions.inflationRate));
  const [incomeReplacementRatio, setIncomeReplacementRatio] = useState(
    String(assumptions.incomeReplacementRatio),
  );
  const [safeWithdrawalRate, setSafeWithdrawalRate] = useState(
    String(assumptions.safeWithdrawalRate),
  );
  const [expectedSocialSecurityMonthly, setExpectedSocialSecurityMonthly] = useState(
    String(assumptions.expectedSocialSecurityMonthly),
  );
  const [currentAnnualSalary, setCurrentAnnualSalary] = useState(
    String(assumptions.currentAnnualSalary),
  );

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await saveRetirementPlanAction({
      birthYear,
      targetRetirementAge,
      expectedReturn,
      inflationRate,
      incomeReplacementRatio,
      safeWithdrawalRate,
      expectedSocialSecurityMonthly,
      currentAnnualSalary,
    });
    if (!r.ok) {
      setError(r.error);
      setBusy(false);
      return;
    }
    setBusy(false);
    setEditing(false);
    router.refresh();
  }

  return (
    <div className="card mb-5 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold">Assumptions</h2>
        <button type="button" className="btn-ghost text-xs" onClick={() => setEditing((v) => !v)}>
          {editing ? "Cancel" : "Edit"}
        </button>
      </div>

      {!editing ? (
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-4">
          <SummaryItem label="Birth year" value={String(assumptions.birthYear)} />
          <SummaryItem label="Retirement age" value={String(assumptions.targetRetirementAge)} />
          <SummaryItem label="Expected return" value={`${assumptions.expectedReturn}%`} />
          <SummaryItem label="Inflation" value={`${assumptions.inflationRate}%`} />
          <SummaryItem
            label="Income replacement"
            value={`${assumptions.incomeReplacementRatio}%`}
          />
          <SummaryItem
            label="Safe withdrawal rate"
            value={`${assumptions.safeWithdrawalRate}%`}
          />
          <SummaryItem
            label="Social Security"
            value={`${formatUSDWhole(assumptions.expectedSocialSecurityMonthly)}/mo`}
          />
          <SummaryItem
            label="Annual salary"
            value={formatUSDWhole(assumptions.currentAnnualSalary)}
          />
        </dl>
      ) : (
        <form onSubmit={save} className="mt-3 grid gap-3 sm:grid-cols-4">
          <Field label="Birth year">
            <input
              type="number"
              className="input"
              value={birthYear}
              onChange={(e) => setBirthYear(e.target.value)}
            />
          </Field>
          <Field label="Retirement age">
            <input
              type="number"
              className="input"
              value={targetRetirementAge}
              onChange={(e) => setTargetRetirementAge(e.target.value)}
            />
          </Field>
          <Field label="Expected return (%)">
            <input
              type="number"
              step="0.1"
              className="input"
              value={expectedReturn}
              onChange={(e) => setExpectedReturn(e.target.value)}
            />
          </Field>
          <Field label="Inflation (%)">
            <input
              type="number"
              step="0.1"
              className="input"
              value={inflationRate}
              onChange={(e) => setInflationRate(e.target.value)}
            />
          </Field>
          <Field label="Income replacement (%)">
            <input
              type="number"
              className="input"
              value={incomeReplacementRatio}
              onChange={(e) => setIncomeReplacementRatio(e.target.value)}
            />
          </Field>
          <Field label="Safe withdrawal rate (%)">
            <input
              type="number"
              step="0.1"
              className="input"
              value={safeWithdrawalRate}
              onChange={(e) => setSafeWithdrawalRate(e.target.value)}
            />
          </Field>
          <Field label="Social Security (monthly)">
            <input
              type="text"
              inputMode="decimal"
              className="input"
              value={expectedSocialSecurityMonthly}
              onChange={(e) => setExpectedSocialSecurityMonthly(e.target.value)}
            />
          </Field>
          <Field label="Annual salary">
            <input
              type="text"
              inputMode="decimal"
              className="input"
              value={currentAnnualSalary}
              onChange={(e) => setCurrentAnnualSalary(e.target.value)}
            />
          </Field>

          {error && <p className="text-sm text-expense sm:col-span-4">{error}</p>}

          <button type="submit" className="btn-primary sm:col-span-4" disabled={busy}>
            {busy ? "Saving..." : "Save assumptions"}
          </button>
        </form>
      )}
    </div>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-muted">{label}</dt>
      <dd className="money mt-0.5 font-medium">{value}</dd>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
    </label>
  );
}
