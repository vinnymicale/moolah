"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  saveYtdContributionsAction,
  clearYtdContributionsAction,
} from "@/actions/retirement";
import type { RetirementAccountDTO, YtdContributionDTO } from "@/lib/queries/retirement";
import type { ContributionSource } from "@/generated/prisma/enums";

// Rollover is deliberately absent: it counts toward no limit, so a box for it
// would only invite people to enter a number that changes nothing.
const YTD_SOURCES: { value: ContributionSource; label: string }[] = [
  { value: "EMPLOYEE_PRETAX", label: "Pre-tax" },
  { value: "EMPLOYEE_ROTH", label: "Roth" },
  { value: "EMPLOYER_MATCH", label: "Employer match" },
  { value: "AFTER_TAX", label: "After-tax" },
];

type Amounts = Record<string, string>;

function amountsFor(ytd: YtdContributionDTO[], accountId: string): Amounts {
  const out: Amounts = {};
  for (const { value } of YTD_SOURCES) {
    const found = ytd.find((y) => y.financialAccountId === accountId && y.source === value);
    out[value] = found ? String(found.amount) : "";
  }
  return out;
}

export function YtdContributionForm({
  accounts,
  ytdContributions,
  year,
  usesYtdOverride,
}: {
  accounts: RetirementAccountDTO[];
  ytdContributions: YtdContributionDTO[];
  year: number;
  usesYtdOverride: boolean;
}) {
  const router = useRouter();
  // Default to whichever account already has totals, so reopening the form
  // shows the numbers that are actually driving the bars.
  const initialAccount = ytdContributions[0]?.financialAccountId ?? accounts[0]?.id ?? "";
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(initialAccount);
  const [amounts, setAmounts] = useState<Amounts>(() =>
    amountsFor(ytdContributions, initialAccount),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectAccount(id: string) {
    setAccountId(id);
    setAmounts(amountsFor(ytdContributions, id));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!accountId) return;
    setBusy(true);
    setError(null);
    const r = await saveYtdContributionsAction({
      financialAccountId: accountId,
      year,
      entries: YTD_SOURCES.map(({ value }) => ({
        source: value,
        amount: amounts[value]?.trim() ? amounts[value] : "0",
      })),
    });
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setOpen(false);
    router.refresh();
  }

  async function clear() {
    setBusy(true);
    setError(null);
    const r = await clearYtdContributionsAction(year);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setAmounts(amountsFor([], accountId));
    setOpen(false);
    router.refresh();
  }

  return (
    <div className="mt-4 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted">
          {usesYtdOverride
            ? `Using your entered ${year} totals instead of the contribution log.`
            : "Totals come from your logged contributions."}
        </p>
        <button
          type="button"
          className="btn-ghost text-xs"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
        >
          {open ? "Cancel" : usesYtdOverride ? "Edit YTD totals" : "Enter YTD totals"}
        </button>
      </div>

      {open && (
        <form onSubmit={submit} className="mt-3 space-y-3">
          {accounts.length > 1 && (
            <label className="block">
              <span className="mb-1 block text-xs text-muted">Account</span>
              <select
                className="input w-full"
                value={accountId}
                onChange={(e) => selectAccount(e.target.value)}
              >
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <div className="grid gap-2 sm:grid-cols-2">
            {YTD_SOURCES.map(({ value, label }) => (
              <label key={value} className="block">
                <span className="mb-1 block text-xs text-muted">{label}</span>
                <input
                  type="text"
                  inputMode="decimal"
                  className="input w-full"
                  placeholder="0"
                  value={amounts[value] ?? ""}
                  onChange={(e) =>
                    setAmounts((prev) => ({ ...prev, [value]: e.target.value }))
                  }
                />
              </label>
            ))}
          </div>

          <p className="text-xs text-muted">
            Entering totals here overrides the contribution log for {year}. Leave a box blank
            to record nothing for that source.
          </p>

          {error && <p className="text-sm text-expense">{error}</p>}

          <div className="flex gap-2">
            <button type="submit" className="btn-primary" disabled={busy || !accountId}>
              {busy ? "Saving..." : "Save YTD totals"}
            </button>
            {usesYtdOverride && (
              <button type="button" className="btn-ghost" onClick={clear} disabled={busy}>
                Use contribution log
              </button>
            )}
          </div>
        </form>
      )}
    </div>
  );
}
