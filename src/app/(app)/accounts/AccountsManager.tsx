"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Plus, Pencil, TrendingUp, Archive, Trash2, Receipt, AlertTriangle } from "lucide-react";
import { Modal } from "@/components/Modal";
import { Dot } from "@/components/ui-bits";
import { formatUSD } from "@/lib/money";
import type { AccountDTO, SnapshotDTO } from "@/lib/queries";
import {
  ACCOUNT_TYPE_LABELS, ACCOUNT_TYPE_OPTIONS, defaultIncludeInCash,
} from "@/lib/account-meta";
import {
  createAccountAction, updateAccountAction, archiveAccountAction,
  deleteAccountAction, addSnapshotAction, type AccountInput,
} from "@/actions/accounts";
import type { AccountType } from "@/generated/prisma/enums";

const COLORS = ["#2563eb", "#0891b2", "#16a34a", "#7c3aed", "#9333ea", "#dc2626", "#d97706", "#0d9488", "#db2777", "#64748b"];

export function AccountsManager({ accounts, snapshots }: { accounts: AccountDTO[]; snapshots: SnapshotDTO[] }) {
  const [editing, setEditing] = useState<AccountDTO | null>(null);
  const [adding, setAdding] = useState(false);
  const [snapshotFor, setSnapshotFor] = useState<AccountDTO | null>(null);

  const assets = accounts.filter((a) => a.isAsset);
  const liabilities = accounts.filter((a) => !a.isAsset);

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setAdding(true)} className="btn-primary">
          <Plus size={16} /> Add account
        </button>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <AccountGroup
          title="Assets"
          accounts={assets}
          snapshots={snapshots}
          onEdit={setEditing}
          onSnapshot={setSnapshotFor}
        />
        <AccountGroup
          title="Liabilities"
          accounts={liabilities}
          snapshots={snapshots}
          onEdit={setEditing}
          onSnapshot={setSnapshotFor}
        />
      </div>

      {(adding || editing) && (
        <AccountForm
          account={editing}
          onClose={() => {
            setAdding(false);
            setEditing(null);
          }}
        />
      )}
      {snapshotFor && <SnapshotForm account={snapshotFor} onClose={() => setSnapshotFor(null)} />}
    </>
  );
}

function AccountGroup({
  title,
  accounts,
  snapshots,
  onEdit,
  onSnapshot,
}: {
  title: string;
  accounts: AccountDTO[];
  snapshots: SnapshotDTO[];
  onEdit: (a: AccountDTO) => void;
  onSnapshot: (a: AccountDTO) => void;
}) {
  const total = accounts.reduce((s, a) => s + a.currentBalance, 0);
  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 className="font-semibold">{title}</h2>
        <span className="tabular-nums font-semibold">{formatUSD(total)}</span>
      </div>
      {accounts.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-muted">No {title.toLowerCase()} yet.</p>
      ) : (
        <ul className="divide-y divide-line">
          {accounts.map((a) => {
            const lastSnap = snapshots.filter((s) => s.accountId === a.id).at(-1);
            return (
              <li key={a.id} className="px-4 py-3">
                <div className="flex items-center gap-3">
                  <Dot color={a.color} size={12} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {a.name}
                      {a.isOverdue && (
                        <span className="ml-2 inline-flex items-center gap-0.5 align-middle text-[11px] font-semibold text-expense">
                          <AlertTriangle size={11} /> overdue
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted">
                      {ACCOUNT_TYPE_LABELS[a.type]}
                      {a.institution ? ` · ${a.institution}` : ""}
                      {a.includeInCash ? " · in cash flow" : ""}
                      {!a.includeInNetWorth ? " · not in net worth" : ""}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="tabular-nums font-semibold">{formatUSD(a.currentBalance)}</p>
                    {a.creditLimit ? (
                      <p className="text-[11px] text-muted">
                        {Math.round((a.currentBalance / a.creditLimit) * 100)}% of {formatUSD(a.creditLimit)}
                      </p>
                    ) : lastSnap ? (
                      <p className="text-[11px] text-muted">as of {lastSnap.date}</p>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <Link href={`/transactions?account=${a.id}`} className="btn-ghost h-8 w-8 !p-0" title="View transactions">
                      <Receipt size={14} />
                    </Link>
                    <button onClick={() => onSnapshot(a)} className="btn-ghost h-8 w-8 !p-0" title="Update balance">
                      <TrendingUp size={14} />
                    </button>
                    <button onClick={() => onEdit(a)} className="btn-ghost h-8 w-8 !p-0" title="Edit">
                      <Pencil size={14} />
                    </button>
                  </div>
                </div>
                <CreditCardDetails account={a} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function AccountForm({ account, onClose }: { account: AccountDTO | null; onClose: () => void }) {
  const editing = !!account;
  const [name, setName] = useState(account?.name ?? "");
  const [type, setType] = useState<AccountType>(account?.type ?? "CHECKING");
  const [institution, setInstitution] = useState(account?.institution ?? "");
  const [balance, setBalance] = useState(account ? String(account.currentBalance) : "");
  const [includeInCash, setIncludeInCash] = useState(account?.includeInCash ?? defaultIncludeInCash("CHECKING"));
  const [includeInNetWorth, setIncludeInNetWorth] = useState(account?.includeInNetWorth ?? true);
  const [color, setColor] = useState(account?.color ?? COLORS[0]);
  const [touchedCash, setTouchedCash] = useState(false);
  const [interestRate, setInterestRate] = useState(account?.interestRate !== null && account?.interestRate !== undefined ? String(account.interestRate) : "");
  const [minimumPayment, setMinimumPayment] = useState(account?.minimumPayment !== null && account?.minimumPayment !== undefined ? String(account.minimumPayment) : "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const isLiability = !ACCOUNT_TYPE_OPTIONS.find((o) => o.value === type)?.isAsset;

  const onType = (t: AccountType) => {
    setType(t);
    if (!touchedCash) setIncludeInCash(defaultIncludeInCash(t));
  };

  const submit = () =>
    start(async () => {
      setError(null);
      const input: AccountInput = {
        name, type, institution, currentBalance: balance, includeInCash, includeInNetWorth, color,
        interestRate: isLiability && interestRate !== "" ? interestRate : null,
        minimumPayment: isLiability && minimumPayment !== "" ? minimumPayment : null,
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
          <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Joint Checking" autoFocus />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={(e) => onType(e.target.value as AccountType)}>
              {ACCOUNT_TYPE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Institution</label>
            <input className="input" value={institution} onChange={(e) => setInstitution(e.target.value)} placeholder="Chase" />
          </div>
        </div>
        <div>
          <label className="label">Current balance {isLiability && "(amount owed)"}</label>
          <div className="relative">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
            <input className="input pl-7" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} placeholder="0.00" />
          </div>
        </div>
        {isLiability && (
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Interest rate (APR)</label>
              <div className="relative">
                <input className="input pr-7" inputMode="decimal" value={interestRate} onChange={(e) => setInterestRate(e.target.value)} placeholder="19.99" />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted">%</span>
              </div>
            </div>
            <div>
              <label className="label">Minimum payment</label>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                <input className="input pl-7" inputMode="decimal" value={minimumPayment} onChange={(e) => setMinimumPayment(e.target.value)} placeholder="35" />
              </div>
            </div>
            <p className="col-span-2 -mt-1 text-xs text-muted">Used by the <span className="text-brand">Debt payoff</span> planner.</p>
          </div>
        )}
        <div>
          <label className="label">Color</label>
          <div className="flex flex-wrap gap-2">
            {COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`h-7 w-7 rounded-full ring-2 ring-offset-2 ring-offset-surface ${color === c ? "ring-brand" : "ring-transparent"}`}
                style={{ backgroundColor: c }}
                aria-label={c}
              />
            ))}
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInCash}
            onChange={(e) => {
              setIncludeInCash(e.target.checked);
              setTouchedCash(true);
            }}
          />
          <span>Include in calendar cash-flow projection</span>
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={includeInNetWorth}
            onChange={(e) => setIncludeInNetWorth(e.target.checked)}
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
            <button onClick={submit} disabled={pending || !name} className="btn-primary">
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function CreditCardDetails({ account }: { account: AccountDTO }) {
  const hasCreditData = account.lastStatementBalance !== null || account.nextPaymentDueDate !== null || account.lastPaymentAmount !== null;
  if (!hasCreditData) return null;

  const daysUntilDue = account.nextPaymentDueDate
    ? Math.ceil((new Date(`${account.nextPaymentDueDate}T00:00:00Z`).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div className="ml-5 mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
      {account.lastStatementBalance !== null && (
        <span>
          Statement: <span className="font-medium text-text">{formatUSD(account.lastStatementBalance)}</span>
          {account.lastStatementDate && <span className="ml-1">({fmtDate(account.lastStatementDate)})</span>}
        </span>
      )}
      {account.minimumPayment !== null && (
        <span>Min payment: <span className="font-medium text-text">{formatUSD(account.minimumPayment)}</span></span>
      )}
      {daysUntilDue !== null && (
        <span className={account.isOverdue ? "font-semibold text-expense" : daysUntilDue >= 0 ? "text-warning" : ""}>
          Due: {account.nextPaymentDueDate && fmtDate(account.nextPaymentDueDate)}
          {account.isOverdue ? " (past due)" : daysUntilDue < 0 ? " (paid)" : ` (${daysUntilDue}d)`}
        </span>
      )}
      {account.lastPaymentAmount !== null && account.lastPaymentDate !== null && (
        <span>Last payment: <span className="font-medium text-text">{formatUSD(account.lastPaymentAmount)}</span> on {fmtDate(account.lastPaymentDate)}</span>
      )}
    </div>
  );
}

function fmtDate(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

function SnapshotForm({ account, onClose }: { account: AccountDTO; onClose: () => void }) {
  const [balance, setBalance] = useState(String(account.currentBalance));
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const submit = () =>
    start(async () => {
      setError(null);
      const res = await addSnapshotAction({ accountId: account.id, balance, date, note, setCurrent: true });
      if (!res.ok) {
        setError("error" in res ? (res.error as string) : "Error");
        return;
      }
      onClose();
    });

  return (
    <Modal open onClose={onClose} title={`Update balance — ${account.name}`}>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Records a dated balance for net-worth history and sets the current balance. Handy for retirement
          accounts, vehicles, and property.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">New balance</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
              <input className="input pl-7" inputMode="decimal" value={balance} onChange={(e) => setBalance(e.target.value)} autoFocus />
            </div>
          </div>
          <div>
            <label className="label">As of</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Note (optional)</label>
          <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Quarterly statement" />
        </div>
        {error && <p className="text-sm text-expense">{error}</p>}
        <div className="flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={submit} disabled={pending} className="btn-primary">{pending ? "Saving…" : "Save"}</button>
        </div>
      </div>
    </Modal>
  );
}
