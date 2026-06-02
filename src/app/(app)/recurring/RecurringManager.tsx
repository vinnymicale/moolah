"use client";

import { useState, useTransition } from "react";
import { Plus, Pencil, Trash2, Repeat } from "lucide-react";
import { Modal } from "@/components/Modal";
import { CategoryIcon } from "@/components/CategoryIcon";
import { formatUSD } from "@/lib/money";
import { describeFrequency } from "@/lib/recurrence";
import type { AccountDTO, CategoryDTO, RecurringDTO } from "@/lib/queries";
import {
  createRecurringAction, updateRecurringAction, deleteRecurringAction, type RecurringInput,
} from "@/actions/recurring";
import type { Frequency, TxnType } from "@/generated/prisma/enums";

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every 2 weeks" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
  { value: "DAILY", label: "Daily" },
];

export function RecurringManager({
  rules,
  accounts,
  categories,
}: {
  rules: RecurringDTO[];
  accounts: AccountDTO[];
  categories: CategoryDTO[];
}) {
  const [editing, setEditing] = useState<RecurringDTO | null>(null);
  const [adding, setAdding] = useState(false);
  const catById = new Map(categories.map((c) => [c.id, c]));

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setAdding(true)} className="btn-primary">
          <Plus size={16} /> Add recurring
        </button>
      </div>

      {rules.length === 0 ? (
        <div className="card flex flex-col items-center px-6 py-12 text-center">
          <Repeat className="mb-2 text-muted" />
          <p className="font-medium">No recurring transactions yet</p>
          <p className="mt-1 text-sm text-muted">Add things like paychecks, rent, and subscriptions so they show on your calendar automatically.</p>
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {rules.map((r) => {
            const cat = r.categoryId ? catById.get(r.categoryId) : undefined;
            return (
              <button key={r.id} onClick={() => setEditing(r)} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface2">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${cat?.color ?? "#64748b"}22`, color: cat?.color ?? "#64748b" }}>
                  <CategoryIcon name={cat?.icon ?? "tag"} size={16} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.description}</p>
                  <p className="truncate text-xs text-muted">
                    {describeFrequency(r.frequency, r.interval)}
                    {cat ? ` · ${cat.name}` : ""}
                    {r.endDate ? ` · until ${r.endDate}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 tabular-nums font-semibold ${r.type === "INCOME" ? "text-income" : "text-expense"}`}>
                  {r.type === "INCOME" ? "+" : "−"}
                  {formatUSD(r.amount)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {(adding || editing) && (
        <RecurringForm rule={editing} accounts={accounts} categories={categories} onClose={() => { setAdding(false); setEditing(null); }} />
      )}
    </>
  );
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function RecurringForm({
  rule,
  accounts,
  categories,
  onClose,
}: {
  rule: RecurringDTO | null;
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  onClose: () => void;
}) {
  const editing = !!rule;
  const [type, setType] = useState<TxnType>(rule?.type ?? "EXPENSE");
  const [amount, setAmount] = useState(rule ? String(rule.amount) : "");
  const [description, setDescription] = useState(rule?.description ?? "");
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? "");
  const [accountId, setAccountId] = useState(rule?.accountId ?? accounts.find((a) => a.includeInCash)?.id ?? "");
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? "MONTHLY");
  const [interval, setInterval] = useState(String(rule?.interval ?? 1));
  const [startDate, setStartDate] = useState(rule?.startDate ?? todayISO());
  const [endDate, setEndDate] = useState(rule?.endDate ?? "");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const catOptions = categories.filter((c) => c.kind === type);

  const submit = () =>
    start(async () => {
      setError(null);
      const input: RecurringInput = {
        type, amount, description, categoryId: categoryId || null, accountId: accountId || null,
        frequency, interval, startDate, endDate: endDate || null,
      };
      const res = editing ? await updateRecurringAction(rule!.id, input) : await createRecurringAction(input);
      if (!res.ok) return setError(res.error);
      onClose();
    });

  const remove = () =>
    start(async () => {
      if (!rule) return;
      await deleteRecurringAction(rule.id, false);
      onClose();
    });

  return (
    <Modal open onClose={onClose} title={editing ? "Edit recurring" : "Add recurring"}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface2 p-1">
          {(["EXPENSE", "INCOME"] as TxnType[]).map((t) => (
            <button key={t} onClick={() => { setType(t); setCategoryId(""); }} className={`btn text-sm ${type === t ? (t === "EXPENSE" ? "bg-surface text-expense shadow-sm" : "bg-surface text-income shadow-sm") : "text-muted"}`}>
              {t === "EXPENSE" ? "Expense" : "Income"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Amount</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
              <input className="input pl-7" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="0.00" />
            </div>
          </div>
          <div>
            <label className="label">Description</label>
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Rent" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Category</label>
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorized</option>
              {catOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Account</label>
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">None</option>
              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Frequency</label>
            <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
              {FREQUENCIES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Repeat every</label>
            <input className="input" inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} />
          </div>
          <div>
            <label className="label">Starts</label>
            <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Ends (optional)</label>
            <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        {error && <p className="text-sm text-expense">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          {editing ? (
            <button onClick={remove} disabled={pending} className="btn-danger">
              <Trash2 size={14} /> Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">Cancel</button>
            <button onClick={submit} disabled={pending || !amount || !description} className="btn-primary">{pending ? "Saving…" : "Save"}</button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
