"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { deleteScheduleAction, updateScheduleAction } from "@/actions/retirement";
import { formatUSD } from "@/lib/money";
import type { ContributionScheduleDTO, RetirementAccountDTO } from "@/lib/queries/retirement";

const FREQUENCY_LABEL: Record<ContributionScheduleDTO["frequency"], string> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  BIWEEKLY: "every 2 weeks",
  MONTHLY: "monthly",
  YEARLY: "yearly",
};

const SOURCE_LABEL: Record<ContributionScheduleDTO["source"], string> = {
  EMPLOYEE_PRETAX: "Pre-tax",
  EMPLOYEE_ROTH: "Roth",
  AFTER_TAX: "After-tax",
  EMPLOYER_MATCH: "Employer match",
  ROLLOVER: "Rollover",
};

function cadence(s: ContributionScheduleDTO): string {
  const base = FREQUENCY_LABEL[s.frequency];
  return s.interval > 1 ? `every ${s.interval} × ${base}` : base;
}

/**
 * What the projection actually assumes you contribute, stated both ways. A
 * dollar schedule shows the share of salary it works out to, which is the only
 * place the drift from an intended round percentage becomes visible - so this
 * is also where you switch it to a percent and make that drift go away.
 */
export function ContributionSchedules({
  schedules,
  accounts,
}: {
  schedules: ContributionScheduleDTO[];
  accounts: RetirementAccountDTO[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);

  if (schedules.length === 0) return null;

  return (
    <div className="card mb-5 p-4">
      <h2 className="mb-3 text-sm font-semibold">Your contribution schedule</h2>
      <ul className="space-y-2 text-sm">
        {schedules.map((s) =>
          editingId === s.id ? (
            <li key={s.id}>
              <ScheduleForm
                schedule={s}
                accounts={accounts}
                onDone={() => setEditingId(null)}
              />
            </li>
          ) : (
            <li
              key={s.id}
              className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1"
            >
              <span>
                {s.accountName}
                <span className="text-muted"> · {SOURCE_LABEL[s.source]}</span>
              </span>
              <span className="flex items-baseline gap-2">
                <span className="tabular-nums">
                  {formatUSD(s.amount)} {cadence(s)}
                  {s.percentOfSalary !== null && (
                    <span className="text-muted">
                      {" "}
                      · {s.percentOfSalary.toFixed(1)}% of salary
                      {s.basis === "PERCENT_OF_SALARY" && " (set as a percent)"}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  className="btn-ghost text-xs"
                  onClick={() => setEditingId(s.id)}
                >
                  Edit
                </button>
              </span>
            </li>
          ),
        )}
      </ul>
      <p className="mt-3 text-xs text-muted">
        Percent-based schedules rise with your salary. Fixed-dollar ones stay flat, so their share
        of pay shrinks as you get raises.
      </p>
    </div>
  );
}

function ScheduleForm({
  schedule,
  accounts,
  onDone,
}: {
  schedule: ContributionScheduleDTO;
  accounts: RetirementAccountDTO[];
  onDone: () => void;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(schedule.financialAccountId);
  const [basis, setBasis] = useState(schedule.basis);
  // Seeded from whichever field the current basis uses, so opening the form on a
  // dollar row and switching to percent starts from the rate it already implies.
  const [amount, setAmount] = useState(String(schedule.amount));
  const [percent, setPercent] = useState(
    schedule.percentOfSalary !== null ? schedule.percentOfSalary.toFixed(2) : "",
  );
  const [source, setSource] = useState(schedule.source);
  const [frequency, setFrequency] = useState(schedule.frequency);
  const [interval, setInterval] = useState(String(schedule.interval));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await updateScheduleAction(schedule.id, {
      financialAccountId: accountId,
      basis,
      amount: basis === "AMOUNT" ? amount : null,
      percentOfSalary: basis === "PERCENT_OF_SALARY" ? percent : null,
      source,
      frequency,
      interval,
      // Timing isn't editable here, so it round-trips untouched.
      startDate: schedule.startDate,
      endDate: schedule.endDate,
      dayOfMonth: schedule.dayOfMonth,
      weekday: schedule.weekday,
    });
    if (!r.ok) {
      setError(r.error);
      setBusy(false);
      return;
    }
    setBusy(false);
    onDone();
    router.refresh();
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const r = await deleteScheduleAction(schedule.id);
    if (!r.ok) {
      setError(r.error);
      setBusy(false);
      return;
    }
    setBusy(false);
    onDone();
    router.refresh();
  }

  return (
    <form onSubmit={save} className="grid gap-2 rounded border border-line p-3 sm:grid-cols-6">
      <select
        className="input w-full"
        value={accountId}
        onChange={(e) => setAccountId(e.target.value)}
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.name}
          </option>
        ))}
      </select>
      <select
        className="input w-full"
        value={basis}
        onChange={(e) => setBasis(e.target.value as ContributionScheduleDTO["basis"])}
      >
        <option value="AMOUNT">Dollars</option>
        <option value="PERCENT_OF_SALARY">% of salary</option>
      </select>
      {basis === "AMOUNT" ? (
        <input
          type="text"
          inputMode="decimal"
          className="input w-full"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
      ) : (
        <input
          type="text"
          inputMode="decimal"
          className="input w-full"
          placeholder="Percent"
          value={percent}
          onChange={(e) => setPercent(e.target.value)}
        />
      )}
      <select
        className="input w-full"
        value={source}
        onChange={(e) => setSource(e.target.value as ContributionScheduleDTO["source"])}
      >
        {Object.entries(SOURCE_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <select
        className="input w-full"
        value={frequency}
        onChange={(e) => setFrequency(e.target.value as ContributionScheduleDTO["frequency"])}
      >
        {Object.entries(FREQUENCY_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>
      <input
        type="number"
        min="1"
        className="input w-full"
        value={interval}
        onChange={(e) => setInterval(e.target.value)}
      />

      {error && <p className="text-sm text-expense sm:col-span-6">{error}</p>}

      <div className="flex gap-2 sm:col-span-6">
        <button type="submit" className="btn-primary text-xs" disabled={busy}>
          {busy ? "Saving..." : "Save"}
        </button>
        <button type="button" className="btn-ghost text-xs" onClick={onDone} disabled={busy}>
          Cancel
        </button>
        <button
          type="button"
          className="btn-ghost ml-auto text-xs text-expense"
          onClick={remove}
          disabled={busy}
        >
          Delete
        </button>
      </div>
    </form>
  );
}
