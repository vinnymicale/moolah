"use client";

import { useState, useTransition } from "react";
import { Modal } from "./Modal";
import type { AccountDTO, CategoryDTO, TransactionDTO } from "@/lib/queries";
import {
  createTransactionAction,
  updateTransactionAction,
  deleteTransactionAction,
} from "@/actions/transactions";
import type { Frequency } from "@/generated/prisma/enums";

type TxType = "INCOME" | "EXPENSE";

export interface TransactionModalProps {
  open: boolean;
  onClose: () => void;
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  /** Pre-fill the date (YYYY-MM-DD) for new transactions. */
  defaultDate?: string;
  /** Existing transaction to edit. */
  transaction?: TransactionDTO | null;
}

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every 2 weeks" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
  { value: "DAILY", label: "Daily" },
];

export function TransactionModal(props: TransactionModalProps) {
  const { open, onClose, accounts, categories, defaultDate, transaction } = props;
  const editing = !!transaction;

  const [type, setType] = useState<TxType>(transaction?.type ?? "EXPENSE");
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : "");
  const [date, setDate] = useState(transaction?.date ?? defaultDate ?? todayISO());
  const [description, setDescription] = useState(transaction?.description ?? "");
  const [categoryId, setCategoryId] = useState(transaction?.categoryId ?? "");
  const [accountId, setAccountId] = useState(
    transaction?.accountId ?? accounts.find((a) => a.includeInCash)?.id ?? accounts[0]?.id ?? "",
  );
  const [cleared, setCleared] = useState(transaction?.cleared ?? true);
  const [recurring, setRecurring] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>("MONTHLY");
  const [interval, setInterval] = useState("1");
  const [endDate, setEndDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const catOptions = categories.filter((c) => c.kind === type);

  const submit = () =>
    start(async () => {
      setError(null);
      const payload = {
        type,
        amount,
        date,
        description,
        categoryId: categoryId || null,
        accountId: accountId || null,
        cleared,
        recurring:
          recurring && !editing
            ? { frequency, interval, endDate: endDate || null }
            : null,
      };
      const res = editing
        ? await updateTransactionAction(transaction!.id, payload)
        : await createTransactionAction(payload);
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      onClose();
    });

  const remove = () =>
    start(async () => {
      if (!transaction) return;
      await deleteTransactionAction(transaction.id);
      onClose();
    });

  return (
    <Modal open={open} onClose={onClose} title={editing ? "Edit transaction" : "Add transaction"}>
      <div className="space-y-4">
        {/* Type toggle */}
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-surface2 p-1">
          {(["EXPENSE", "INCOME"] as TxType[]).map((t) => (
            <button
              key={t}
              onClick={() => {
                setType(t);
                setCategoryId("");
              }}
              className={`btn text-sm ${
                type === t
                  ? t === "EXPENSE"
                    ? "bg-surface text-expense shadow-sm"
                    : "bg-surface text-income shadow-sm"
                  : "text-muted"
              }`}
            >
              {t === "EXPENSE" ? "Expense" : "Income"}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Amount</label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
              <input
                className="input pl-7"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>
          </div>
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Description</label>
          <input
            className="input"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={type === "EXPENSE" ? "e.g. Groceries at Costco" : "e.g. Paycheck"}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Category</label>
            <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Uncategorized</option>
              {catOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Account</label>
            <select className="input" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
              <option value="">None</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={cleared} onChange={(e) => setCleared(e.target.checked)} />
          <span>Already {type === "INCOME" ? "received" : "paid"} (uncheck if it&apos;s expected/upcoming)</span>
        </label>

        {!editing && (
          <div className="rounded-lg border border-line p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={recurring} onChange={(e) => setRecurring(e.target.checked)} />
              Make this recurring
            </label>
            {recurring && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Frequency</label>
                  <select className="input" value={frequency} onChange={(e) => setFrequency(e.target.value as Frequency)}>
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Repeat every</label>
                  <input className="input" inputMode="numeric" value={interval} onChange={(e) => setInterval(e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="label">End date (optional)</label>
                  <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-expense">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          {editing ? (
            <button onClick={remove} disabled={pending} className="btn-danger">
              Delete
            </button>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button onClick={submit} disabled={pending || !amount || !description} className="btn-primary">
              {pending ? "Saving…" : editing ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
