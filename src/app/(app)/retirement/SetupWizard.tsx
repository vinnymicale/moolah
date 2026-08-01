"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveRetirementPlanAction,
  completeWizardAction,
  createScheduleAction,
  saveEmployerMatchAction,
} from "@/actions/retirement";
import type { RetirementAccountDTO } from "@/lib/queries/retirement";
import { PageHeader } from "@/components/ui-bits";

const CURRENT_YEAR = new Date().getUTCFullYear();

type ScheduleDraft = {
  accountId: string;
  enabled: boolean;
  amount: string;
  frequency: "WEEKLY" | "BIWEEKLY" | "MONTHLY";
  source: "EMPLOYEE_PRETAX" | "EMPLOYEE_ROTH" | "AFTER_TAX";
};

export function SetupWizard({ accounts }: { accounts: RetirementAccountDTO[] }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Step 1
  const [birthYear, setBirthYear] = useState(String(CURRENT_YEAR - 35));
  const [salary, setSalary] = useState("");
  const [retireAge, setRetireAge] = useState("65");

  // Step 2: which accounts fund retirement (all pre-checked).
  const [selected, setSelected] = useState<Set<string>>(new Set(accounts.map((a) => a.id)));

  // Step 3
  const [drafts, setDrafts] = useState<ScheduleDraft[]>(
    accounts.map((a) => ({
      accountId: a.id,
      enabled: false,
      amount: "",
      frequency: "MONTHLY",
      source: "EMPLOYEE_PRETAX",
    })),
  );
  const [matchAccountId, setMatchAccountId] = useState("");
  const [matchPercent, setMatchPercent] = useState("100");
  const [matchUpTo, setMatchUpTo] = useState("3");

  // Step 4
  const [expectedReturn, setExpectedReturn] = useState("7");
  const [inflation, setInflation] = useState("3");
  const [replacement, setReplacement] = useState("80");
  const [socialSecurity, setSocialSecurity] = useState("0");

  const toggleAccount = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const updateDraft = (accountId: string, patch: Partial<ScheduleDraft>) => {
    setDrafts((prev) => prev.map((d) => (d.accountId === accountId ? { ...d, ...patch } : d)));
  };

  async function finish() {
    setBusy(true);
    setError(null);

    const planResult = await saveRetirementPlanAction({
      birthYear,
      targetRetirementAge: retireAge,
      expectedReturn,
      inflationRate: inflation,
      incomeReplacementRatio: replacement,
      safeWithdrawalRate: 4,
      expectedSocialSecurityMonthly: socialSecurity || 0,
      currentAnnualSalary: salary || 0,
    });
    if (!planResult.ok) {
      setError(planResult.error);
      setBusy(false);
      return;
    }

    const today = new Date().toISOString().slice(0, 10);
    for (const d of drafts) {
      if (!d.enabled || !selected.has(d.accountId) || !d.amount) continue;
      const r = await createScheduleAction({
        financialAccountId: d.accountId,
        amount: d.amount,
        source: d.source,
        frequency: d.frequency,
        interval: 1,
        startDate: today,
        dayOfMonth: d.frequency === "MONTHLY" ? 1 : null,
        weekday: d.frequency === "MONTHLY" ? null : 5,
      });
      if (!r.ok) {
        setError(r.error);
        setBusy(false);
        return;
      }
    }

    if (matchAccountId) {
      const r = await saveEmployerMatchAction({
        financialAccountId: matchAccountId,
        tiers: [{ matchPercent, upToPercentOfSalary: matchUpTo }],
        annualCap: null,
      });
      if (!r.ok) {
        setError(r.error);
        setBusy(false);
        return;
      }
    }

    const done = await completeWizardAction();
    if (!done.ok) {
      setError(done.error);
      setBusy(false);
      return;
    }
    router.refresh();
  }

  const steps = ["About you", "Your accounts", "Contributions", "Assumptions"];

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader
        title="Set up retirement planning"
        subtitle="Four quick steps. Everything here can be changed later."
      />

      <ol className="mb-5 flex flex-wrap gap-2 text-xs">
        {steps.map((label, i) => (
          <li
            key={label}
            className={`rounded-full border px-3 py-1 ${
              i === step
                ? "border-brand/40 bg-brand/10 text-brand"
                : i < step
                  ? "border-transparent text-muted"
                  : "border-transparent text-muted/60"
            }`}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      <div className="card space-y-4 p-5">
        {step === 0 && (
          <>
            <Field label="Birth year">
              <input
                type="number"
                className="input"
                value={birthYear}
                onChange={(e) => setBirthYear(e.target.value)}
              />
            </Field>
            <Field label="Current annual salary" hint="Used for the income replacement target and employer match.">
              <input
                type="text"
                inputMode="decimal"
                className="input"
                placeholder="100,000"
                value={salary}
                onChange={(e) => setSalary(e.target.value)}
              />
            </Field>
            <Field label="Target retirement age">
              <input
                type="number"
                className="input"
                value={retireAge}
                onChange={(e) => setRetireAge(e.target.value)}
              />
            </Field>
          </>
        )}

        {step === 1 && (
          <>
            <p className="text-sm text-muted">
              Which accounts are you counting on for retirement? Uncheck anything earmarked for
              something else, like a brokerage saved for a house.
            </p>
            {accounts.map((a) => (
              <label key={a.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={selected.has(a.id)}
                  onChange={() => toggleAccount(a.id)}
                />
                <span>{a.name}</span>
                <span className="text-muted">${Math.round(a.balance).toLocaleString()}</span>
              </label>
            ))}
          </>
        )}

        {step === 2 && (
          <>
            <p className="text-sm text-muted">
              Record what you contribute regularly. Skip any account you&apos;d rather log by hand.
            </p>
            {accounts
              .filter((a) => selected.has(a.id))
              .map((a) => {
                const draft = drafts.find((d) => d.accountId === a.id)!;
                return (
                  <div key={a.id} className="rounded-lg border border-line p-3">
                    <label className="flex items-center gap-2 text-sm font-medium">
                      <input
                        type="checkbox"
                        checked={draft.enabled}
                        onChange={(e) => updateDraft(a.id, { enabled: e.target.checked })}
                      />
                      {a.name}
                    </label>
                    {draft.enabled && (
                      <div className="mt-2 grid gap-2 sm:grid-cols-3">
                        <input
                          type="text"
                          inputMode="decimal"
                          className="input"
                          placeholder="Amount"
                          value={draft.amount}
                          onChange={(e) => updateDraft(a.id, { amount: e.target.value })}
                        />
                        <select
                          className="input"
                          value={draft.frequency}
                          onChange={(e) =>
                            updateDraft(a.id, { frequency: e.target.value as ScheduleDraft["frequency"] })
                          }
                        >
                          <option value="WEEKLY">Weekly</option>
                          <option value="BIWEEKLY">Every 2 weeks</option>
                          <option value="MONTHLY">Monthly</option>
                        </select>
                        <select
                          className="input"
                          value={draft.source}
                          onChange={(e) =>
                            updateDraft(a.id, { source: e.target.value as ScheduleDraft["source"] })
                          }
                        >
                          <option value="EMPLOYEE_PRETAX">Pre-tax</option>
                          <option value="EMPLOYEE_ROTH">Roth</option>
                          <option value="AFTER_TAX">After-tax</option>
                        </select>
                      </div>
                    )}
                  </div>
                );
              })}

            <div className="rounded-lg border border-line p-3">
              <p className="text-sm font-medium">Employer match (optional)</p>
              <div className="mt-2 grid gap-2 sm:grid-cols-3">
                <select
                  className="input"
                  value={matchAccountId}
                  onChange={(e) => setMatchAccountId(e.target.value)}
                >
                  <option value="">No match</option>
                  {accounts
                    .filter((a) => selected.has(a.id))
                    .map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                </select>
                <input
                  type="number"
                  className="input"
                  placeholder="Match %"
                  value={matchPercent}
                  onChange={(e) => setMatchPercent(e.target.value)}
                />
                <input
                  type="number"
                  className="input"
                  placeholder="Up to % of salary"
                  value={matchUpTo}
                  onChange={(e) => setMatchUpTo(e.target.value)}
                />
              </div>
              <p className="mt-1 text-xs text-muted">
                e.g. 100% of the first 3% of salary.
              </p>
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="text-sm text-muted">
              These are estimates, not predictions. The defaults are common planning assumptions
              and you can change them any time.
            </p>
            <Field label="Expected annual return (%)">
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
                value={inflation}
                onChange={(e) => setInflation(e.target.value)}
              />
            </Field>
            <Field
              label="Income replacement (%)"
              hint="Share of your current salary you'd want in retirement."
            >
              <input
                type="number"
                className="input"
                value={replacement}
                onChange={(e) => setReplacement(e.target.value)}
              />
            </Field>
            <Field label="Expected Social Security (monthly)">
              <input
                type="text"
                inputMode="decimal"
                className="input"
                value={socialSecurity}
                onChange={(e) => setSocialSecurity(e.target.value)}
              />
            </Field>
          </>
        )}

        {error && <p className="text-sm text-expense">{error}</p>}

        <div className="flex justify-between gap-2 pt-2">
          <button
            type="button"
            className="btn-ghost"
            disabled={step === 0 || busy}
            onClick={() => setStep((s) => s - 1)}
          >
            Back
          </button>
          {step < steps.length - 1 ? (
            <button type="button" className="btn-primary" onClick={() => setStep((s) => s + 1)}>
              Next
            </button>
          ) : (
            <button type="button" className="btn-primary" disabled={busy} onClick={finish}>
              {busy ? "Saving..." : "Finish setup"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-muted">{hint}</span>}
    </label>
  );
}
