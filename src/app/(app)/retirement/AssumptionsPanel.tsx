"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { saveRetirementPlanAction, saveEmployerMatchAction } from "@/actions/retirement";
import { formatUSDWhole } from "@/lib/money";
import type { RetirementAssumptions } from "@/lib/retirement-types";
import type { EmployerMatchDTO, RetirementAccountDTO } from "@/lib/queries/retirement";

type TierDraft = { matchPercent: string; upToPercentOfSalary: string };

export function AssumptionsPanel({
  assumptions,
  accounts,
  employerMatch,
}: {
  assumptions: RetirementAssumptions;
  accounts: RetirementAccountDTO[];
  employerMatch: EmployerMatchDTO | null;
}) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [matchAccountId, setMatchAccountId] = useState(
    employerMatch?.financialAccountId ?? accounts[0]?.id ?? "",
  );
  const [tiers, setTiers] = useState<TierDraft[]>(
    employerMatch?.tiers.map((t) => ({
      matchPercent: String(t.matchPercent),
      upToPercentOfSalary: String(t.upToPercentOfSalary),
    })) ?? [{ matchPercent: "100", upToPercentOfSalary: "3" }],
  );
  const [annualCap, setAnnualCap] = useState(
    employerMatch?.annualCap === null || employerMatch?.annualCap === undefined
      ? ""
      : String(employerMatch.annualCap),
  );

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

    // A tier with both fields blank is an empty row the user never filled in,
    // not an instruction to save a zero-percent tier.
    const filledTiers = tiers.filter((t) => t.matchPercent !== "" || t.upToPercentOfSalary !== "");
    if (matchAccountId && filledTiers.length > 0) {
      const m = await saveEmployerMatchAction({
        financialAccountId: matchAccountId,
        tiers: filledTiers.map((t) => ({
          matchPercent: t.matchPercent,
          upToPercentOfSalary: t.upToPercentOfSalary,
        })),
        annualCap: annualCap === "" ? null : annualCap,
      });
      if (!m.ok) {
        setError(m.error);
        setBusy(false);
        return;
      }
    }

    setBusy(false);
    setEditing(false);
    router.refresh();
  }

  const addTier = () =>
    setTiers((prev) =>
      prev.length >= 5 ? prev : [...prev, { matchPercent: "", upToPercentOfSalary: "" }],
    );
  const removeTier = (i: number) => setTiers((prev) => prev.filter((_, idx) => idx !== i));
  const updateTier = (i: number, patch: Partial<TierDraft>) =>
    setTiers((prev) => prev.map((t, idx) => (idx === i ? { ...t, ...patch } : t)));

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
          <SummaryItem
            label="Employer match"
            value={
              employerMatch
                ? employerMatch.tiers
                    .map((t) => `${t.matchPercent}% of ${t.upToPercentOfSalary}%`)
                    .join(", ") + (employerMatch.annualCap ? `, capped at ${formatUSDWhole(employerMatch.annualCap)}` : "")
                : "Not set"
            }
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
          <Field label="Social Security (monthly, today's $)">
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

          <div className="border-t border-line pt-3 sm:col-span-4">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">
              Employer match
            </h3>
            <p className="mt-1 text-xs text-muted">
              Tiers apply in order, each as a share of salary: &ldquo;100% of the first 3%, then
              50% of the next 2%&rdquo; is two tiers. Only pre-tax and Roth contributions earn a
              match.
            </p>

            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <Field label="Account">
                <select
                  className="input"
                  value={matchAccountId}
                  onChange={(e) => setMatchAccountId(e.target.value)}
                >
                  {accounts.map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Annual cap (optional)">
                <input
                  type="text"
                  inputMode="decimal"
                  className="input"
                  placeholder="No cap"
                  value={annualCap}
                  onChange={(e) => setAnnualCap(e.target.value)}
                />
              </Field>
            </div>

            {tiers.map((t, i) => (
              <div key={i} className="mt-3 flex items-end gap-2">
                <Field label="Match (%)">
                  <input
                    type="number"
                    className="input"
                    value={t.matchPercent}
                    onChange={(e) => updateTier(i, { matchPercent: e.target.value })}
                  />
                </Field>
                <Field label="Of the next (% of salary)">
                  <input
                    type="number"
                    step="0.1"
                    className="input"
                    value={t.upToPercentOfSalary}
                    onChange={(e) => updateTier(i, { upToPercentOfSalary: e.target.value })}
                  />
                </Field>
                {tiers.length > 1 && (
                  <button
                    type="button"
                    className="btn-ghost mb-1 text-xs"
                    onClick={() => removeTier(i)}
                  >
                    Remove
                  </button>
                )}
              </div>
            ))}

            {tiers.length < 5 && (
              <button type="button" className="btn-ghost mt-2 text-xs" onClick={addTier}>
                Add tier
              </button>
            )}
          </div>

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
