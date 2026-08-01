"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createContributionAction, deleteContributionAction } from "@/actions/retirement";
import ConfirmDeleteButton from "@/components/ConfirmDeleteButton";
import { formatUSD } from "@/lib/money";
import type { RetirementAccountDTO, ContributionDTO } from "@/lib/queries/retirement";
import type { ContributionSource } from "@/generated/prisma/enums";

const SOURCE_OPTIONS: { value: ContributionSource; label: string }[] = [
  { value: "EMPLOYEE_PRETAX", label: "Pre-tax" },
  { value: "EMPLOYEE_ROTH", label: "Roth" },
  { value: "EMPLOYER_MATCH", label: "Employer match" },
  { value: "AFTER_TAX", label: "After-tax" },
  { value: "ROLLOVER", label: "Rollover" },
];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ContributionLog({
  accounts,
  recentContributions,
  currentMonthlyContribution,
}: {
  accounts: RetirementAccountDTO[];
  recentContributions: ContributionDTO[];
  currentMonthlyContribution: number;
}) {
  const router = useRouter();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [date, setDate] = useState(todayISO());
  const [amount, setAmount] = useState("");
  const [source, setSource] = useState<ContributionSource>("EMPLOYEE_PRETAX");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId || !amount) return;
    setBusy(true);
    setError(null);
    const r = await createContributionAction({
      financialAccountId: accountId,
      date,
      amount,
      source,
    });
    if (!r.ok) {
      setError(r.error);
      setBusy(false);
      return;
    }
    setAmount("");
    setBusy(false);
    router.refresh();
  }

  async function remove(id: string) {
    setError(null);
    const r = await deleteContributionAction(id);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
  }

  return (
    <div className="card mb-5 p-4">
      <h2 className="mb-3 text-sm font-semibold">Contributions</h2>

      {currentMonthlyContribution === 0 && (
        <p className="mb-3 text-sm text-muted">
          No contribution schedule yet. Projections assume you add nothing from here.
        </p>
      )}

      <form onSubmit={submit} className="mb-4 grid gap-2 sm:grid-cols-5">
        <select
          className="input sm:col-span-2"
          value={accountId}
          onChange={(e) => setAccountId(e.target.value)}
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          className="input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <input
          type="text"
          inputMode="decimal"
          className="input"
          placeholder="Amount"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <select
          className="input"
          value={source}
          onChange={(e) => setSource(e.target.value as ContributionSource)}
        >
          {SOURCE_OPTIONS.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
        </select>
        <button type="submit" className="btn-primary sm:col-span-5" disabled={busy || !accountId}>
          {busy ? "Adding..." : "Add contribution"}
        </button>
      </form>

      {error && <p className="mb-3 text-sm text-expense">{error}</p>}

      {recentContributions.length === 0 ? (
        <p className="text-sm text-muted">No contributions recorded yet.</p>
      ) : (
        <ul className="space-y-2">
          {recentContributions.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 text-sm">
              <div className="min-w-0">
                <p className="truncate font-medium">{c.accountName}</p>
                <p className="text-xs text-muted">
                  {c.date} - {SOURCE_OPTIONS.find((s) => s.value === c.source)?.label ?? c.source}
                  {c.note ? ` - ${c.note}` : ""}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="money font-medium">{formatUSD(c.amount)}</span>
                <ConfirmDeleteButton
                  onConfirm={() => remove(c.id)}
                  label={`contribution to ${c.accountName}`}
                  size="sm"
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
