"use client";

import { useState, useTransition } from "react";
import { Check, Loader2, Pencil } from "lucide-react";
import { formatUSD } from "@/lib/money";
import { updateDebtTermsAction } from "@/actions/accounts";
import type { AccountDTO } from "@/lib/queries";

export function TermsRow({ debt }: { debt: AccountDTO }) {
  const [editing, setEditing] = useState(true);
  const [apr, setApr] = useState(debt.interestRate !== null ? String(debt.interestRate) : "");
  const [min, setMin] = useState(debt.minimumPayment !== null ? String(debt.minimumPayment) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const save = () =>
    start(async () => {
      setError(null);
      const res = await updateDebtTermsAction(debt.id, { interestRate: apr, minimumPayment: min });
      if (!res.ok) return setError(res.error);
      setEditing(false);
    });

  if (!editing) {
    return (
      <div className="flex items-center gap-2 rounded-lg bg-surface px-3 py-2 text-sm">
        <span className="flex-1 font-medium">{debt.name}</span>
        <span className="text-muted">{apr}% · {formatUSD(Number(min))}/mo</span>
        <button onClick={() => setEditing(true)} className="btn-ghost h-7 w-7 p-0!" title="Edit"><Pencil size={13} /></button>
      </div>
    );
  }

  return (
    <div className="rounded-lg bg-surface px-3 py-2">
      <div className="flex flex-wrap items-end gap-2">
        <span className="min-w-24 flex-1 text-sm font-medium">{debt.name}</span>
        <label className="text-[11px] text-muted">
          APR %
          <input value={apr} onChange={(e) => setApr(e.target.value)} inputMode="decimal" className="input h-8 w-20 text-sm" placeholder="19.99" />
        </label>
        <label className="text-[11px] text-muted">
          Min / mo
          <div className="relative w-24">
            <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted">$</span>
            <input value={min} onChange={(e) => setMin(e.target.value)} inputMode="decimal" className="input h-8 w-full pl-5 text-sm" placeholder="35" />
          </div>
        </label>
        <button onClick={save} disabled={pending || !apr || !min} className="btn-primary h-8">
          {pending ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-expense">{error}</p>}
    </div>
  );
}
