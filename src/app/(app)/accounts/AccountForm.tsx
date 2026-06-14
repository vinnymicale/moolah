"use client";

import { useState, useTransition } from "react";
import { Archive, Trash2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import {
  ACCOUNT_TYPE_OPTIONS, defaultIncludeInCash,
} from "@/lib/account-meta";
import {
  createAccountAction, updateAccountAction, archiveAccountAction,
  deleteAccountAction, type AccountInput,
} from "@/actions/accounts";
import { COLOR_PALETTE } from "@/lib/colors";
import type { AccountDTO } from "@/lib/queries";
import type { AccountType } from "@/generated/prisma/enums";

/** Optional numeric field -> the string the form input expects ("" when unset). */
function numField(n: number | null | undefined): string {
  return n !== null && n !== undefined ? String(n) : "";
}

export function AccountForm({ account, onClose }: { account: AccountDTO | null; onClose: () => void }) {
  const editing = !!account;
  const [form, setForm] = useState({
    name: account?.name ?? "",
    type: (account?.type ?? "CHECKING") as AccountType,
    institution: account?.institution ?? "",
    balance: account ? String(account.currentBalance) : "",
    includeInCash: account?.includeInCash ?? defaultIncludeInCash("CHECKING"),
    includeInNetWorth: account?.includeInNetWorth ?? true,
    color: account?.color ?? "#2563eb",
    interestRate: numField(account?.interestRate),
    minimumPayment: numField(account?.minimumPayment),
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Whether the user has manually toggled cash-inclusion. Until they do,
  // changing the account type re-applies that type's sensible default.
  const [touchedCash, setTouchedCash] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const isLiability = !ACCOUNT_TYPE_OPTIONS.find((o) => o.value === form.type)?.isAsset;

  const onType = (t: AccountType) =>
    setForm((f) => ({
      ...f,
      type: t,
      includeInCash: touchedCash ? f.includeInCash : defaultIncludeInCash(t),
    }));

  const submit = () =>
    start(async () => {
      setError(null);
      const input: AccountInput = {
        name: form.name, type: form.type, institution: form.institution,
        currentBalance: form.balance, includeInCash: form.includeInCash,
        includeInNetWorth: form.includeInNetWorth, color: form.color,
        interestRate: isLiability && form.interestRate !== "" ? form.interestRate : null,
        minimumPayment: isLiability && form.minimumPayment !== "" ? form.minimumPayment : null,
        includeInDebtPlanner: true,
      };
      const res = editing ? await updateAccountAction(account!.id, input) : await createAccountAction(input);
      if (!res.ok) {
        setError(res.error ?? "Error");
        return;
      }
      onClose();
    });

  const removeOrArchive = (fn: () => Promise<unknown>) => start(async () => {
    await fn();
    onClose();
  });

  return (
    <Modal open onClose={onClose} title={editing ? "Edit account" : "Add account"}>
      <div className="space-y-4">
        <div>
          <label className="label">Name</label>
          <input className="input" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="Joint Checking" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Type</label>
            <select className="input" value={form.type} onChange={(e) => onType(e.target.value as AccountType)}>
              {ACCOUNT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Institution</label>
            <input className="input" value={form.institution} onChange={(e) => set("institution", e.target.value)} placeholder="Chase" />
          </div>
        </div>
        <div>
          <label className="label">Current balance {isLiability && "(amount owed)"}</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
            <input className="input pl-7" inputMode="decimal" value={form.balance} onChange={(e) => set("balance", e.target.value)} placeholder="0.00" />
          </div>
        </div>
        {isLiability && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Interest rate (APR)</label>
              <div className="relative">
                <input className="input pr-7" inputMode="decimal" value={form.interestRate} onChange={(e) => set("interestRate", e.target.value)} placeholder="19.99" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>
              </div>
            </div>
            <div>
              <label className="label">Minimum payment</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                <input className="input pl-7" inputMode="decimal" value={form.minimumPayment} onChange={(e) => set("minimumPayment", e.target.value)} placeholder="35" />
              </div>
            </div>
            <p className="col-span-2 -mt-1 text-xs text-muted">Used by the <span className="text-brand">Debt payoff</span> planner.</p>
          </div>
        )}
        <div>
          <label className="label">Color</label>
          <div className="flex flex-wrap gap-2">
            {COLOR_PALETTE.map((c) => (
              <button
                key={c}
                onClick={() => set("color", c)}
                className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-surface ${form.color === c ? "ring-brand" : "ring-transparent"}`}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.includeInCash}
            onChange={(e) => {
              set("includeInCash", e.target.checked);
              setTouchedCash(true);
            }}
          />
          <span>Include in calendar cash-flow projection</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={form.includeInNetWorth}
            onChange={(e) => set("includeInNetWorth", e.target.checked)}
          />
          <span>Count toward net worth</span>
        </label>
        {error && <p className="text-sm text-expense">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          {editing ? (
            <div className="flex gap-2">
              <button onClick={() => removeOrArchive(() => archiveAccountAction(account!.id, !account!.archived))} className="btn-ghost" disabled={pending}>
                <Archive size={14} /> Archive
              </button>
              <button onClick={() => removeOrArchive(() => deleteAccountAction(account!.id))} className="btn-danger" disabled={pending}>
                <Trash2 size={14} />
              </button>
            </div>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={submit} disabled={pending || !form.name} className="btn-primary">
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
