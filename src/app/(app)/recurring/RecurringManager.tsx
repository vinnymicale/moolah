"use client";

import { useEffect, useState, useTransition } from "react";
import { Plus, Trash2, Repeat, Sparkles, X, Check, Loader2 } from "lucide-react";
import { Modal } from "@/components/Modal";
import { CategoryIcon } from "@/components/CategoryIcon";
import { formatUSD } from "@/lib/money";
import { describeFrequency } from "@/lib/recurrence";
import type { AccountDTO, CategoryDTO, RecurringDTO, RecurringSuggestion } from "@/lib/queries";
import {
  createRecurringAction, updateRecurringAction, deleteRecurringAction, type RecurringInput,
} from "@/actions/recurring";
import type { Frequency, TxnType } from "@/generated/prisma/enums";

const DISMISSED_KEY = "dismissedRecurringSuggestions";

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
  suggestions = [],
}: {
  rules: RecurringDTO[];
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  suggestions?: RecurringSuggestion[];
}) {
  const [editing, setEditing] = useState<RecurringDTO | null>(null);
  const [adding, setAdding] = useState(false);
  const [prefill, setPrefill] = useState<RecurringSuggestion | null>(null);
  // Dismissed suggestions persist in localStorage so they don't reappear on
  // reload. `mounted` keeps SSR output (no stored data) matching the first
  // client render, avoiding a hydration mismatch.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [mounted, setMounted] = useState(false);
  const catById = new Map(categories.map((c) => [c.id, c]));

  useEffect(() => {
    let stored = new Set<string>();
    try {
      const raw = localStorage.getItem(DISMISSED_KEY);
      if (raw) stored = new Set(JSON.parse(raw) as string[]);
    } catch {
      // ignore unavailable/corrupt storage
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time hydrate of persisted UI state
    setMounted(true);
    if (stored.size) setDismissed(stored);
  }, []);

  const dismiss = (key: string) => {
    const next = new Set(dismissed).add(key);
    setDismissed(next);
    try {
      localStorage.setItem(DISMISSED_KEY, JSON.stringify([...next]));
    } catch {
      // ignore unavailable storage
    }
  };

  const visibleSuggestions = mounted ? suggestions.filter((s) => !dismissed.has(s.key)) : [];
  const closeForm = () => { setAdding(false); setEditing(null); setPrefill(null); };

  return (
    <>
      <div className="mb-4 flex justify-end">
        <button onClick={() => setAdding(true)} className="btn-primary">
          <Plus size={16} /> Add recurring
        </button>
      </div>

      {visibleSuggestions.length > 0 && (
        <SuggestionsPanel
          suggestions={visibleSuggestions}
          catById={catById}
          onReview={(s) => setPrefill(s)}
          onDismiss={dismiss}
        />
      )}

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
                  {r.type === "INCOME" ? "+" : "-"}
                  {formatUSD(r.amount)}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {(adding || editing || prefill) && (
        <RecurringForm rule={editing} prefill={prefill} accounts={accounts} categories={categories} onClose={closeForm} />
      )}
    </>
  );
}

function SuggestionsPanel({
  suggestions,
  catById,
  onReview,
  onDismiss,
}: {
  suggestions: RecurringSuggestion[];
  catById: Map<string, CategoryDTO>;
  onReview: (s: RecurringSuggestion) => void;
  onDismiss: (key: string) => void;
}) {
  return (
    <div className="card mb-5 overflow-hidden border-brand/40">
      <div className="flex items-center gap-2 border-b border-line bg-brand/5 px-4 py-3">
        <Sparkles size={16} className="text-brand" />
        <h2 className="font-semibold">Suggested recurring</h2>
        <span className="text-xs text-muted">found in your history</span>
      </div>
      <ul className="divide-y divide-line">
        {suggestions.map((s) => (
          <SuggestionRow key={s.key} s={s} cat={s.categoryId ? catById.get(s.categoryId) : undefined} onReview={onReview} onDismiss={onDismiss} />
        ))}
      </ul>
    </div>
  );
}

function SuggestionRow({
  s,
  cat,
  onReview,
  onDismiss,
}: {
  s: RecurringSuggestion;
  cat?: CategoryDTO;
  onReview: (s: RecurringSuggestion) => void;
  onDismiss: (key: string) => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const quickAdd = () =>
    start(async () => {
      setError(null);
      const res = await createRecurringAction({
        type: s.type,
        amount: String(s.amount),
        description: s.description,
        categoryId: s.categoryId,
        accountId: s.accountId,
        frequency: s.frequency,
        interval: String(s.interval),
        startDate: s.startDate,
        endDate: null,
      });
      // On success the page revalidates and this suggestion drops out (it now
      // matches an existing rule); on failure surface the message.
      if (!res.ok) setError(res.error);
    });

  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${cat?.color ?? "#64748b"}22`, color: cat?.color ?? "#64748b" }}>
        <CategoryIcon name={cat?.icon ?? "repeat"} size={16} />
      </span>
      <button onClick={() => onReview(s)} className="min-w-0 flex-1 text-left" title="Review & edit before adding">
        <p className="truncate font-medium">{s.description}</p>
        <p className="truncate text-xs text-muted">
          Seen {s.count}× · {s.cadence}
          {cat ? ` · ${cat.name}` : ""}
        </p>
        {error && <p className="text-xs text-expense">{error}</p>}
      </button>
      <span className={`shrink-0 tabular-nums font-semibold ${s.type === "INCOME" ? "text-income" : "text-expense"}`}>
        {s.type === "INCOME" ? "+" : "-"}
        {formatUSD(s.amount)}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <button onClick={quickAdd} disabled={pending} className="btn-primary h-8 text-xs" title="Add as recurring">
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Add
        </button>
        <button onClick={() => onDismiss(s.key)} className="btn-ghost h-8 w-8 !p-0" title="Dismiss" aria-label="Dismiss suggestion">
          <X size={15} />
        </button>
      </div>
    </li>
  );
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function RecurringForm({
  rule,
  prefill,
  accounts,
  categories,
  onClose,
}: {
  rule: RecurringDTO | null;
  prefill?: RecurringSuggestion | null;
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  onClose: () => void;
}) {
  const editing = !!rule;
  const [type, setType] = useState<TxnType>(rule?.type ?? prefill?.type ?? "EXPENSE");
  const [amount, setAmount] = useState(rule ? String(rule.amount) : prefill ? String(prefill.amount) : "");
  const [description, setDescription] = useState(rule?.description ?? prefill?.description ?? "");
  const [categoryId, setCategoryId] = useState(rule?.categoryId ?? prefill?.categoryId ?? "");
  const [accountId, setAccountId] = useState(rule?.accountId ?? prefill?.accountId ?? accounts.find((a) => a.includeInCash)?.id ?? "");
  const [frequency, setFrequency] = useState<Frequency>(rule?.frequency ?? prefill?.frequency ?? "MONTHLY");
  const [interval, setInterval] = useState(String(rule?.interval ?? prefill?.interval ?? 1));
  const [startDate, setStartDate] = useState(rule?.startDate ?? prefill?.startDate ?? todayISO());
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
