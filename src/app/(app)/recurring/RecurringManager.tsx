"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Plus, Trash2, Repeat, Sparkles, X, Check, Loader2, Link2, ListFilter, EyeOff, Undo2, ChevronDown, ChevronRight } from "lucide-react";
import { useConfirmAction } from "@/lib/useConfirmAction";
import { Modal } from "@/components/Modal";
import { CategoryIcon } from "@/components/CategoryIcon";
import { describeFrequency, expandOccurrences } from "@/lib/recurrence";
import { categoryColor } from "@/lib/colors";
import { useIsHydrated, usePersistentState } from "@/lib/usePersistentState";
import { Amount } from "@/components/Amount";
import type { AccountDTO, CategoryDTO, RecurringDTO, RecurringSuggestion } from "@/lib/queries";
import {
  createRecurringAction, updateRecurringAction, deleteRecurringAction,
  deleteRecurringVersionAction, linkSuggestionToRuleAction,
  type EditMode, type RecurringInput,
} from "@/actions/recurring";
import { addUTCDays, formatMonthDayYear, isoDay, localTodayISO, parseISODay } from "@/lib/dates";
import type { Frequency, TxnType } from "@/generated/prisma/enums";

const DISMISSED_KEY = "dismissedRecurringSuggestions";
const NONE: string[] = [];

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
  // reload. `hydrated` keeps SSR output (no stored data) matching the first
  // client render, avoiding a hydration mismatch.
  const [dismissed, setDismissed] = usePersistentState<string[]>(DISMISSED_KEY, NONE);
  const hydrated = useIsHydrated();
  const [showIgnored, setShowIgnored] = useState(false);
  const catById = new Map(categories.map((c) => [c.id, c]));

  const dismiss = (key: string) => setDismissed([...dismissed, key]);
  const restore = (key: string) => setDismissed(dismissed.filter((k) => k !== key));

  const visibleSuggestions = hydrated ? suggestions.filter((s) => !dismissed.includes(s.key)) : [];
  // Only suggestions the detector still finds can be shown again. Keys for
  // series that have since stopped repeating stay in storage but have nothing
  // to render, so they're dropped here rather than counted.
  const ignoredSuggestions = hydrated ? suggestions.filter((s) => dismissed.includes(s.key)) : [];
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
          rules={rules}
          catById={catById}
          onReview={(s) => setPrefill(s)}
          onDismiss={dismiss}
        />
      )}

      {ignoredSuggestions.length > 0 && (
        <IgnoredPanel
          suggestions={ignoredSuggestions}
          catById={catById}
          open={showIgnored}
          onToggle={() => setShowIgnored((v) => !v)}
          onRestore={restore}
          onRestoreAll={() => setDismissed(dismissed.filter((k) => !ignoredSuggestions.some((s) => s.key === k)))}
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
              <div key={r.id} className="flex items-center hover:bg-surface2">
                <button onClick={() => setEditing(r)} className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 text-left">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${categoryColor(cat)}22`, color: categoryColor(cat) }}>
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
                  <Amount type={r.type} amount={r.amount} className="shrink-0 font-semibold" />
                </button>
                <Link
                  href={`/transactions?range=12m&recurring=${r.id}`}
                  className="btn-ghost mr-3 h-8 w-8 shrink-0 p-0! text-muted hover:text-brand"
                  title={`View transactions for ${r.description}`}
                  aria-label={`View transactions for ${r.description}`}
                >
                  <ListFilter size={15} />
                </Link>
              </div>
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
  rules,
  catById,
  onReview,
  onDismiss,
}: {
  suggestions: RecurringSuggestion[];
  rules: RecurringDTO[];
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
          <SuggestionRow
            key={s.key}
            s={s}
            rules={rules}
            cat={s.categoryId ? catById.get(s.categoryId) : undefined}
            onReview={onReview}
            onDismiss={onDismiss}
          />
        ))}
      </ul>
    </div>
  );
}

function IgnoredPanel({
  suggestions,
  catById,
  open,
  onToggle,
  onRestore,
  onRestoreAll,
}: {
  suggestions: RecurringSuggestion[];
  catById: Map<string, CategoryDTO>;
  open: boolean;
  onToggle: () => void;
  onRestore: (key: string) => void;
  onRestoreAll: () => void;
}) {
  return (
    <div className="card mb-5 overflow-hidden">
      <button
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-surface2"
      >
        {open ? <ChevronDown size={16} className="text-muted" /> : <ChevronRight size={16} className="text-muted" />}
        <EyeOff size={16} className="text-muted" />
        <h2 className="font-semibold">Ignored suggestions</h2>
        <span className="text-xs text-muted">{suggestions.length}</span>
      </button>
      {open && (
        <>
          <ul className="divide-y divide-line border-t border-line">
            {suggestions.map((s) => {
              const cat = s.categoryId ? catById.get(s.categoryId) : undefined;
              return (
                <li key={s.key} className="flex items-center gap-3 px-4 py-3">
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${categoryColor(cat)}22`, color: categoryColor(cat) }}>
                    <CategoryIcon name={cat?.icon ?? "repeat"} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{s.description}</p>
                    <p className="truncate text-xs text-muted">
                      Seen {s.count}× · {s.cadence}
                      {cat ? ` · ${cat.name}` : ""}
                    </p>
                  </div>
                  <Amount type={s.type} amount={s.amount} className="shrink-0 font-semibold" />
                  <button
                    onClick={() => onRestore(s.key)}
                    className="btn-ghost h-8 shrink-0 text-xs"
                    title="Show this suggestion again"
                  >
                    <Undo2 size={14} /> Restore
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="flex justify-end border-t border-line px-4 py-2">
            <button onClick={onRestoreAll} className="btn-ghost h-8 text-xs">
              <Undo2 size={14} /> Restore all
            </button>
          </div>
        </>
      )}
    </div>
  );
}

function SuggestionRow({
  s,
  rules,
  cat,
  onReview,
  onDismiss,
}: {
  s: RecurringSuggestion;
  rules: RecurringDTO[];
  cat?: CategoryDTO;
  onReview: (s: RecurringSuggestion) => void;
  onDismiss: (key: string) => void;
}) {
  const [pending, start] = useTransition();
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [linking, setLinking] = useState(false);
  // The rule the user picked from the dropdown, held until they confirm. Linking
  // is irreversible (there's no unlink UI), so a wrong pick shouldn't fire on
  // the change event.
  const [chosenRuleId, setChosenRuleId] = useState("");

  // Only same-type rules can plausibly be the same series.
  const linkableRules = rules.filter((r) => r.type === s.type);

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
      if (!res.ok) return setError(res.error);
      router.refresh();
    });

  const linkTo = (ruleId: string) =>
    start(async () => {
      setError(null);
      const res = await linkSuggestionToRuleAction(ruleId, s.key);
      if (!res.ok) return setError(res.error);
      // On success the page revalidates: the matched transactions are now linked,
      // so this suggestion drops out on its own.
      router.refresh();
    });

  return (
    <li className="px-4 py-3">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${categoryColor(cat)}22`, color: categoryColor(cat) }}>
          <CategoryIcon name={cat?.icon ?? "repeat"} size={16} />
        </span>
        <button onClick={() => onReview(s)} className="min-w-0 flex-1 text-left" title="Review & edit before adding">
          <p className="truncate font-medium">{s.description}</p>
          <p className="truncate text-xs text-muted">
            Seen {s.count}× · {s.cadence}
            {cat ? ` · ${cat.name}` : ""}
          </p>
        </button>
        <Amount type={s.type} amount={s.amount} className="shrink-0 font-semibold" />
        <div className="flex shrink-0 items-center gap-1">
          <button onClick={quickAdd} disabled={pending} className="btn-primary h-8 text-xs" title="Add as recurring">
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />} Add
          </button>
          {linkableRules.length > 0 && (
            <button
              onClick={() => { setLinking((v) => !v); setChosenRuleId(""); }}
              disabled={pending}
              className={`btn-ghost h-8 w-8 p-0! ${linking ? "text-brand" : ""}`}
              title="Already a recurring item? Link it to that rule"
              aria-label="Link to an existing recurring rule"
            >
              <Link2 size={15} />
            </button>
          )}
          <button onClick={() => onDismiss(s.key)} className="btn-ghost h-8 w-8 p-0!" title="Dismiss" aria-label="Dismiss suggestion">
            <X size={15} />
          </button>
        </div>
      </div>

      {linking && linkableRules.length > 0 && (
        <div className="mt-2 flex flex-wrap items-center gap-2 rounded-lg bg-surface2 px-3 py-2">
          <span className="text-xs text-muted">Already tracked by:</span>
          <select
            className="input h-8 w-auto text-xs"
            value={chosenRuleId}
            disabled={pending}
            aria-label="Choose the existing recurring rule"
            onChange={(e) => setChosenRuleId(e.target.value)}
          >
            <option value="" disabled>Choose a rule…</option>
            {linkableRules.map((r) => (
              <option key={r.id} value={r.id}>
                {r.description} · {describeFrequency(r.frequency, r.interval)}
              </option>
            ))}
          </select>
          <button
            onClick={() => linkTo(chosenRuleId)}
            disabled={pending || !chosenRuleId}
            className="btn-primary h-8 text-xs"
            title="Link the matching transactions to this rule"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Link2 size={14} />} Link
          </button>
          <button
            onClick={() => { setLinking(false); setChosenRuleId(""); }}
            disabled={pending}
            className="btn-ghost h-8 text-xs"
          >
            Cancel
          </button>
          <p className="w-full text-[11px] text-muted">
            Links the {s.count} matching transactions to the chosen rule so this stops being
            suggested. This can&apos;t be undone here, so check the rule before linking.
          </p>
        </div>
      )}

      {error && <p className="mt-1 text-xs text-expense">{error}</p>}
    </li>
  );
}

/**
 * The first occurrence strictly after `afterISO` under `sched`. Used to default
 * a forward-dated edit to the next charge, and to preview when the new schedule
 * first bites.
 */
function nextOccurrence(
  sched: { frequency: Frequency; interval: number; startDate: string; endDate: string | null; dayOfMonth: number | null; weekday: number | null },
  afterISO: string,
): string | null {
  const from = addUTCDays(parseISODay(afterISO), 1);
  const dates = expandOccurrences(sched, from, addUTCDays(from, 400));
  return dates.length ? isoDay(dates[0]) : null;
}

/** "Since Sep 5, 2026" / "Jan 1 - Sep 4, 2026" for one row of the history list. */
function versionRange(rule: RecurringDTO, index: number): string {
  const v = rule.versions[index];
  // versions is newest-first, so the one that superseded this is at index - 1.
  const next = index > 0 ? rule.versions[index - 1] : null;
  const from = formatMonthDayYear(v.effectiveFrom);
  if (!next) return `Since ${from}`;
  return `${from} - ${formatMonthDayYear(isoDay(addUTCDays(parseISODay(next.effectiveFrom), -1)))}`;
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
  const [startDate, setStartDate] = useState(rule?.startDate ?? prefill?.startDate ?? localTodayISO());
  const [endDate, setEndDate] = useState(rule?.endDate ?? "");
  const [mode, setMode] = useState<"forward" | "correct">("forward");
  const [effectiveFrom, setEffectiveFrom] = useState(
    () => (rule ? nextOccurrence(rule, localTodayISO()) ?? localTodayISO() : localTodayISO()),
  );
  const [showHistory, setShowHistory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const catOptions = categories.filter((c) => c.kind === type);

  const submit = () =>
    start(async () => {
      setError(null);
      const input: RecurringInput = {
        type, amount, description, categoryId: categoryId || null, accountId: accountId || null,
        frequency, interval, startDate, endDate: endDate || null,
      };
      const edit: EditMode = mode === "forward" ? { mode: "forward", effectiveFrom } : { mode: "correct" };
      const res = editing
        ? await updateRecurringAction(rule!.id, input, edit)
        : await createRecurringAction(input);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onClose();
    });

  const remove = () =>
    start(async () => {
      if (!rule) return;
      const res = await deleteRecurringAction(rule.id, false);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onClose();
    });

  const confirmRemove = useConfirmAction(remove);

  const revert = (versionId: string) =>
    start(async () => {
      if (!rule) return;
      const res = await deleteRecurringVersionAction(rule.id, versionId);
      if (!res.ok) return setError(res.error);
      router.refresh();
      onClose();
    });

  // What the edit will actually do, recomputed as the fields change, so the
  // double-charge case is visible here rather than on the calendar.
  const preview = (() => {
    if (!editing || mode !== "forward") return null;
    const first = nextOccurrence(
      { frequency, interval: Number(interval) || 1, startDate, endDate: endDate || null, dayOfMonth: rule!.dayOfMonth, weekday: rule!.weekday },
      isoDay(addUTCDays(parseISODay(effectiveFrom), -1)),
    );
    return {
      before: formatMonthDayYear(effectiveFrom),
      first: first ? formatMonthDayYear(first) : null,
    };
  })();

  return (
    <Modal open onClose={onClose} title={editing ? "Edit recurring" : "Add recurring"}>
      <div className="space-y-4">
        {editing && (
          <div className="space-y-2 rounded-lg border border-border p-3">
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" className="mt-1" checked={mode === "forward"} onChange={() => setMode("forward")} />
              <span className="flex-1">
                <span className="font-medium">Change going forward</span>
                {mode === "forward" && (
                  <span className="mt-2 flex items-center gap-2">
                    <span className="text-muted">Starting</span>
                    <input className="input w-auto" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} />
                  </span>
                )}
              </span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input type="radio" className="mt-1" checked={mode === "correct"} onChange={() => setMode("correct")} />
              <span className="flex-1">
                <span className="font-medium">Fix this rule everywhere</span>
                <span className="block text-xs text-muted">Corrects history too. Use for typos and wrong entries.</span>
              </span>
            </label>
            {preview && (
              <p className="text-xs text-muted">
                Occurrences before {preview.before} keep the current values.
                {preview.first ? ` First occurrence under the new settings: ${preview.first}.` : ""}
              </p>
            )}
          </div>
        )}

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
            <label className="label">{editing ? "Series began" : "First occurrence"}</label>
            {editing ? (
              <p className="input flex items-center text-muted">{formatMonthDayYear(startDate)}</p>
            ) : (
              <input className="input" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            )}
          </div>
          <div>
            <label className="label">Ends (optional)</label>
            <input className="input" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>

        {editing && (
          <div className="rounded-lg border border-border">
            <button onClick={() => setShowHistory(!showHistory)} className="flex w-full items-center gap-1 px-3 py-2 text-sm text-muted">
              {showHistory ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
              History ({rule!.versions.length})
            </button>
            {showHistory && (
              <ul className="border-t border-border">
                {rule!.versions.map((v, i) => (
                  <li key={v.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                    <span className="w-40 shrink-0 text-muted">{versionRange(rule!, i)}</span>
                    <span className="flex-1">
                      ${v.amount.toLocaleString()} · {describeFrequency(v.frequency, v.interval)}
                    </span>
                    {i === 0 && rule!.versions.length > 1 && (
                      <button onClick={() => revert(v.id)} disabled={pending} className="btn-ghost text-xs">
                        <Undo2 size={12} /> Revert
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {error && <p className="text-sm text-expense">{error}</p>}

        <div className="flex items-center justify-between pt-1">
          {editing ? (
            <button onClick={confirmRemove.trigger} disabled={pending} className="btn-danger">
              <Trash2 size={14} /> {confirmRemove.armed ? "Click to confirm" : "Delete"}
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
