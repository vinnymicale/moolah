"use client";

import { useState, useTransition } from "react";
import { Copy } from "lucide-react";
import { Modal } from "./Modal";
import { SplitEditor, EMPTY_SPLITS, type SplitRow } from "./SplitEditor";
import { TagInput, type TagOption } from "./TagInput";
import type { AccountDTO, CategoryDTO, TransactionDTO } from "@/lib/queries";
import {
  createTransactionAction,
  updateTransactionAction,
  deleteTransactionAction,
  restoreTransactionAction,
  convertToRecurringAction,
} from "@/actions/transactions";
import { validateSplits } from "@/lib/splits";
import { useConfirmAction } from "@/lib/useConfirmAction";
import { useToast } from "./Toast";
import { localTodayISO } from "@/lib/dates";
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
  /**
   * All the user's tags, for autocomplete. Omit entirely (rather than passing
   * []) for callers, like the calendar, that don't manage tags - the tag
   * editor is hidden and the save payload leaves tags untouched.
   */
  tags?: TagOption[];
}

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: "WEEKLY", label: "Weekly" },
  { value: "BIWEEKLY", label: "Every 2 weeks" },
  { value: "MONTHLY", label: "Monthly" },
  { value: "YEARLY", label: "Yearly" },
  { value: "DAILY", label: "Daily" },
];

export function TransactionModal(props: TransactionModalProps) {
  const { open, onClose, accounts, categories, defaultDate, transaction, tags } = props;
  const tagsManaged = tags !== undefined;
  const editing = !!transaction;
  const alreadyRecurring = !!transaction?.recurringRuleId;

  // Category splits, seeded from the existing transaction when it was split.
  const initialSplits: SplitRow[] = (transaction?.splits ?? []).map((s) => ({
    categoryId: s.categoryId ?? "",
    amount: String(s.amount),
  }));

  const [form, setForm] = useState({
    type: (transaction?.type ?? "EXPENSE") as TxType,
    amount: transaction ? String(transaction.amount) : "",
    date: transaction?.date ?? defaultDate ?? localTodayISO(),
    description: transaction?.description ?? "",
    categoryId: transaction?.categoryId ?? "",
    accountId:
      transaction?.accountId ?? accounts.find((a) => a.includeInCash)?.id ?? accounts[0]?.id ?? "",
    note: transaction?.note ?? "",
    cleared: transaction?.cleared ?? true,
    recurring: false,
    frequency: "MONTHLY" as Frequency,
    interval: "1",
    endDate: "",
    tags: transaction?.tags.map((t) => t.name) ?? ([] as string[]),
  });
  const set = <K extends keyof typeof form>(key: K, value: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const [split, setSplit] = useState(initialSplits.length > 0);
  const [splits, setSplits] = useState<SplitRow[]>(
    initialSplits.length > 0 ? initialSplits : EMPTY_SPLITS,
  );
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const { toast } = useToast();

  const catOptions = categories.filter((c) => c.kind === form.type);

  const buildSplits = () =>
    split
      ? splits
        .filter((s) => Number(s.amount) > 0)
        .map((s) => ({ categoryId: s.categoryId || null, amount: Number(s.amount) }))
      : null;

  // Shape the form into the action payload. The recurring field is passed in so
  // create/duplicate/edit can each set it without restating the rest.
  const payload = (recurring: { frequency: Frequency; interval: string; endDate: string | null } | null) => ({
    type: form.type,
    amount: form.amount,
    date: form.date,
    description: form.description,
    note: form.note || null,
    categoryId: form.categoryId || null,
    accountId: form.accountId || null,
    cleared: form.cleared,
    splits: buildSplits(),
    // Only callers that pass the tags prop (and thus render the tag editor)
    // send a tags key - otherwise omit it so the update leaves tags alone
    // instead of wiping them (e.g. editing from the calendar).
    ...(tagsManaged ? { tags: form.tags } : {}),
    recurring,
  });

  const recurringInput = {
    frequency: form.frequency,
    interval: form.interval,
    endDate: form.endDate || null,
  };

  const submit = () =>
    start(async () => {
      setError(null);
      if (split) {
        const parts = buildSplits() ?? [];
        const invalid = validateSplits(Number(form.amount) || 0, parts);
        if (invalid) {
          setError(invalid);
          return;
        }
      }
      const res = editing
        ? await updateTransactionAction(transaction!.id, payload(null))
        : await createTransactionAction(payload(form.recurring ? recurringInput : null));
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
      // When editing an existing one-off, turning on "recurring" promotes it to
      // a series (the create path handles its own recurring inline).
      if (editing && form.recurring && !alreadyRecurring) {
        const conv = await convertToRecurringAction(transaction!.id, recurringInput);
        if (!conv.ok) {
          setError(conv.error ?? "Saved, but couldn't make it recurring.");
          return;
        }
      }
      onClose();
    });

  const remove = () =>
    start(async () => {
      if (!transaction) return;
      const id = transaction.id;
      const res = await deleteTransactionAction(id);
      if (!res.ok) {
        setError(res.error ?? "Couldn't delete that transaction.");
        return;
      }
      onClose();
      toast({
        message: "Transaction deleted.",
        action: {
          label: "Undo",
          onClick: () => { void restoreTransactionAction(id); },
        },
      });
    });
  const confirmRemove = useConfirmAction(remove);

  // Create a fresh copy from the current form values (handy for similar entries).
  const duplicate = () =>
    start(async () => {
      setError(null);
      const res = await createTransactionAction(payload(null));
      if (!res.ok) {
        setError(res.error ?? "Something went wrong.");
        return;
      }
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
                setForm((f) => ({ ...f, type: t, categoryId: "" }));
                // Categories are kind-specific, so clear them; keep the amounts
                // since the split allocation is still valid against the total.
                setSplits((rows) => rows.map((r) => ({ ...r, categoryId: "" })));
              }}
              className={`btn text-sm ${form.type === t
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
                value={form.amount}
                onChange={(e) => set("amount", e.target.value)}
                placeholder="0.00"
                autoFocus
              />
            </div>
          </div>
          <div>
            <label className="label">Date</label>
            <input className="input" type="date" value={form.date} onChange={(e) => set("date", e.target.value)} />
          </div>
        </div>

        <div>
          <label className="label">Description</label>
          <input
            className="input"
            value={form.description}
            onChange={(e) => set("description", e.target.value)}
            placeholder={form.type === "EXPENSE" ? "e.g. Groceries at Costco" : "e.g. Paycheck"}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="flex items-center justify-between">
              <label className="label">Category</label>
              <button
                type="button"
                onClick={() => setSplit((v) => !v)}
                className="text-xs text-muted underline hover:text-text"
              >
                {split ? "Single category" : "Split"}
              </button>
            </div>
            {!split && (
              <select className="input" value={form.categoryId} onChange={(e) => set("categoryId", e.target.value)}>
                <option value="">Uncategorized</option>
                {catOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            )}
            {split && <p className="text-xs text-muted">Split across categories below.</p>}
          </div>
          <div>
            <label className="label">Account</label>
            <select className="input" value={form.accountId} onChange={(e) => set("accountId", e.target.value)}>
              <option value="">None</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {split && (
          <SplitEditor
            categories={catOptions}
            total={Number(form.amount) || 0}
            rows={splits}
            onChange={setSplits}
          />
        )}

        <div>
          <label className="label">Note (optional)</label>
          <textarea
            className="input min-h-16 resize-y"
            value={form.note}
            onChange={(e) => set("note", e.target.value)}
            placeholder="Any extra detail…"
            rows={2}
          />
        </div>

        {tagsManaged && (
          <div>
            <label className="label">Tags</label>
            <TagInput value={form.tags} onChange={(next) => set("tags", next)} options={tags} />
          </div>
        )}

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={form.cleared} onChange={(e) => set("cleared", e.target.checked)} />
          <span>Already {form.type === "INCOME" ? "received" : "paid"} (uncheck if it&apos;s expected/upcoming)</span>
        </label>

        {alreadyRecurring && (
          <p className="rounded-lg border border-line bg-surface2/50 px-3 py-2 text-xs text-muted">
            Part of a recurring series. Edit the schedule on the Recurring page.
          </p>
        )}

        {!alreadyRecurring && (
          <div className="rounded-lg border border-line p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" checked={form.recurring} onChange={(e) => set("recurring", e.target.checked)} />
              Make this recurring
            </label>
            {editing && form.recurring && (
              <p className="mt-2 text-xs text-muted">
                Creates a recurring series starting on this transaction&apos;s date.
              </p>
            )}
            {form.recurring && (
              <div className="mt-3 grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Frequency</label>
                  <select className="input" value={form.frequency} onChange={(e) => set("frequency", e.target.value as Frequency)}>
                    {FREQUENCIES.map((f) => (
                      <option key={f.value} value={f.value}>
                        {f.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Repeat every</label>
                  <input className="input" inputMode="numeric" value={form.interval} onChange={(e) => set("interval", e.target.value)} />
                </div>
                <div className="col-span-2">
                  <label className="label">End date (optional)</label>
                  <input className="input" type="date" value={form.endDate} onChange={(e) => set("endDate", e.target.value)} />
                </div>
              </div>
            )}
          </div>
        )}

        {error && <p className="text-sm text-expense">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          {editing ? (
            <div className="flex gap-2">
              <button onClick={confirmRemove.trigger} disabled={pending} className="btn-danger">
                {confirmRemove.armed ? "Click to confirm" : "Delete"}
              </button>
              <button onClick={duplicate} disabled={pending} className="btn-ghost" title="Create a copy">
                <Copy size={14} /> Duplicate
              </button>
            </div>
          ) : (
            <span />
          )}
          <div className="flex gap-2">
            <button onClick={onClose} className="btn-ghost">
              Cancel
            </button>
            <button onClick={submit} disabled={pending || !form.amount || !form.description} className="btn-primary">
              {pending ? "Saving…" : editing ? "Save" : "Add"}
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}
