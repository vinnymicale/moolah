"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, ChevronRight, Search, Plus, Download, Clock,
  CheckSquare, Square, Trash2, X, CheckCircle2, StickyNote, BookmarkPlus,
} from "lucide-react";
import { TransactionModal } from "@/components/TransactionModal";
import { CategoryIcon } from "@/components/CategoryIcon";
import { MultiSelect } from "@/components/MultiSelect";
import { formatUSD } from "@/lib/money";
import { monthLabel } from "@/lib/dates";
import {
  bulkSetCategoryAction, bulkSetAccountAction, bulkSetClearedAction, bulkDeleteTransactionsAction,
} from "@/actions/transactions";
import type { AccountDTO, CategoryDTO, TransactionDTO } from "@/lib/queries";

const SAVED_FILTERS_KEY = "txnSavedFilters";

type TxnTypeOpt = "INCOME" | "EXPENSE";
type StatusOpt = "CLEARED" | "PENDING";

interface SavedFilter {
  name: string;
  search: string;
  types: TxnTypeOpt[];
  statuses: StatusOpt[];
  cats: string[];
  accts: string[];
}

/** Split a comma-separated query value into a Set of non-empty tokens. */
function toSet(csv: string): Set<string> {
  return new Set(csv.split(",").map((s) => s.trim()).filter(Boolean));
}

export function TransactionsList({
  transactions,
  accounts,
  categories,
  range,
  rangeLabel,
  monthISO,
  prevMonthISO,
  nextMonthISO,
  initialAccountId = "",
  initialCategoryId = "",
  focusId = "",
  customFrom = "",
  customTo = "",
}: {
  transactions: TransactionDTO[];
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  range: string;
  rangeLabel: string;
  monthISO: string;
  prevMonthISO: string;
  nextMonthISO: string;
  initialAccountId?: string;
  initialCategoryId?: string;
  focusId?: string;
  customFrom?: string;
  customTo?: string;
}) {
  const router = useRouter();
  const focusRef = useRef<HTMLDivElement>(null);
  // Briefly highlight a transaction navigated to from global search.
  const [highlightId, setHighlightId] = useState(focusId);

  useEffect(() => {
    if (!focusId) return;
    setHighlightId(focusId);
    focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlightId(""), 2600);
    return () => clearTimeout(t);
  }, [focusId]);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<Set<string>>(new Set());
  const [catFilter, setCatFilter] = useState<Set<string>>(() => toSet(initialCategoryId));
  const [acctFilter, setAcctFilter] = useState<Set<string>>(() => toSet(initialAccountId));
  const [editing, setEditing] = useState<TransactionDTO | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  // Saved filters (client-side filter combos), persisted in localStorage.
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_FILTERS_KEY);
      if (raw) setSavedFilters(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);
  const persistFilters = (next: SavedFilter[]) => {
    setSavedFilters(next);
    try { localStorage.setItem(SAVED_FILTERS_KEY, JSON.stringify(next)); } catch { /* ignore */ }
  };
  const applyFilter = (f: SavedFilter) => {
    setSearch(f.search);
    setTypeFilter(new Set(f.types));
    setStatusFilter(new Set(f.statuses));
    setCatFilter(new Set(f.cats));
    setAcctFilter(new Set(f.accts));
  };
  const saveCurrentFilter = () => {
    const name = window.prompt("Name this filter (e.g. \"Uber this year\"):")?.trim();
    if (!name) return;
    const next = [
      ...savedFilters.filter((f) => f.name !== name),
      {
        name, search,
        types: [...typeFilter] as TxnTypeOpt[],
        statuses: [...statusFilter] as StatusOpt[],
        cats: [...catFilter],
        accts: [...acctFilter],
      },
    ];
    persistFilters(next);
  };
  const hasActiveFilters = !!search || typeFilter.size > 0 || statusFilter.size > 0 || catFilter.size > 0 || acctFilter.size > 0;
  const clearAllFilters = () => {
    setSearch("");
    setTypeFilter(new Set());
    setStatusFilter(new Set());
    setCatFilter(new Set());
    setAcctFilter(new Set());
  };

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const acctById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const filtered = transactions.filter((t) => {
    // Empty set = no constraint; otherwise the row must match one selected value.
    if (typeFilter.size > 0 && !typeFilter.has(t.type)) return false;
    if (statusFilter.size > 0 && !statusFilter.has(t.cleared ? "CLEARED" : "PENDING")) return false;
    if (catFilter.size > 0) {
      const key = t.categoryId ?? "__uncategorized__";
      if (!catFilter.has(key)) return false;
    }
    if (acctFilter.size > 0) {
      const key = t.accountId ?? "__none__";
      if (!acctFilter.has(key)) return false;
    }
    if (search) {
      const q = search.toLowerCase();
      const cat = t.categoryId ? catById.get(t.categoryId)?.name ?? "" : "";
      const note = t.note ?? "";
      if (
        !t.description.toLowerCase().includes(q) &&
        !cat.toLowerCase().includes(q) &&
        !note.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });

  const income = filtered.filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0);
  const expense = filtered.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0);

  // Preserve the account & category filters across range/month navigation by
  // serialising the selected sets as comma-separated query params.
  const acctQS = acctFilter.size > 0 ? `&account=${[...acctFilter].join(",")}` : "";
  const catQS = catFilter.size > 0 ? `&category=${[...catFilter].join(",")}` : "";
  const filterQS = `${acctQS}${catQS}`;
  const changeRange = (value: string) => {
    if (value === "custom") {
      // Default the custom window to the current month until the user edits it.
      const from = customFrom || `${monthISO.slice(0, 7)}-01`;
      const to = customTo || monthISO.slice(0, 7) + "-" + endOfMonthDay(monthISO);
      router.push(`/transactions?range=custom&from=${from}&to=${to}${filterQS}`);
    } else if (value === "month") router.push(`/transactions?m=${monthISO.slice(0, 7)}${filterQS}`);
    else router.push(`/transactions?range=${value}${filterQS}`);
  };
  const applyCustom = (from: string, to: string) => {
    if (!from || !to) return;
    const lo = from <= to ? from : to;
    const hi = from <= to ? to : from;
    router.push(`/transactions?range=custom&from=${lo}&to=${hi}${filterQS}`);
  };

  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id));
  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(filtered.map((t) => t.id)));
  const clearSelection = () => setSelected(new Set());

  const runBulk = (fn: (ids: string[]) => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setBulkError(null);
      const ids = [...selected];
      if (ids.length === 0) return;
      const res = await fn(ids);
      if (res.ok) clearSelection();
      else setBulkError(res.error ?? "Something went wrong.");
    });

  const bulkDelete = () => {
    if (!confirm(`Delete ${selected.size} transaction${selected.size === 1 ? "" : "s"}? This can't be undone.`)) return;
    runBulk((ids) => bulkDeleteTransactionsAction(ids));
  };

  const exportCsv = () => {
    const header = ["Date", "Type", "Amount", "Description", "Category", "Account", "Cleared", "Note"];
    const rows = filtered.map((t) => [
      t.date,
      t.type,
      String(t.amount),
      csv(t.description),
      csv(t.categoryId ? catById.get(t.categoryId)?.name ?? "" : ""),
      csv(t.accountId ? acctById.get(t.accountId)?.name ?? "" : ""),
      t.cleared ? "yes" : "no",
      csv(t.note ?? ""),
    ]);
    const content = [header, ...rows].map((r) => r.join(",")).join("\n");
    const blob = new Blob([content], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `transactions-${monthISO.slice(0, 7)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {range === "month" ? (
            <>
              <Link href={`/transactions?m=${prevMonthISO.slice(0, 7)}${filterQS}`} className="btn-ghost h-9 w-9 !p-0" aria-label="Previous">
                <ChevronLeft size={18} />
              </Link>
              <span className="min-w-40 text-center font-semibold">{monthLabel(new Date(`${monthISO}T00:00:00Z`))}</span>
              <Link href={`/transactions?m=${nextMonthISO.slice(0, 7)}${filterQS}`} className="btn-ghost h-9 w-9 !p-0" aria-label="Next">
                <ChevronRight size={18} />
              </Link>
            </>
          ) : (
            <span className="min-w-40 font-semibold">{rangeLabel}</span>
          )}
          <select className="input h-9 w-auto text-sm" value={range} onChange={(e) => changeRange(e.target.value)} aria-label="Time range">
            <option value="month">By month</option>
            <option value="3m">Last 3 months</option>
            <option value="12m">Last 12 months</option>
            <option value="ytd">Year to date</option>
            <option value="all">All time</option>
            <option value="custom">Custom range…</option>
          </select>
          {range === "custom" && (
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                value={customFrom}
                max={customTo || undefined}
                onChange={(e) => applyCustom(e.target.value, customTo)}
                className="input h-9 w-auto text-sm"
                aria-label="From date"
              />
              <span className="text-muted">–</span>
              <input
                type="date"
                value={customTo}
                min={customFrom || undefined}
                onChange={(e) => applyCustom(customFrom, e.target.value)}
                className="input h-9 w-auto text-sm"
                aria-label="To date"
              />
            </div>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={exportCsv} className="btn-ghost h-9" title="Export CSV">
            <Download size={15} /> <span className="hidden sm:inline">Export</span>
          </button>
          <button onClick={() => setAdding(true)} className="btn-primary h-9">
            <Plus size={16} /> Add
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input data-search="true" className="input pl-9" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>

        <MultiSelect
          label="Type"
          allLabel="All types"
          selected={typeFilter}
          onChange={setTypeFilter}
          options={[
            { value: "EXPENSE", label: "Expenses" },
            { value: "INCOME", label: "Income" },
          ]}
        />
        <MultiSelect
          label="Status"
          allLabel="All status"
          selected={statusFilter}
          onChange={setStatusFilter}
          options={[
            { value: "CLEARED", label: "Cleared" },
            { value: "PENDING", label: "Pending" },
          ]}
        />
        <MultiSelect
          label="Categories"
          allLabel="All categories"
          selected={catFilter}
          onChange={setCatFilter}
          options={[
            { value: "__uncategorized__", label: "Uncategorized" },
            ...categories.map((c) => ({ value: c.id, label: c.name, color: c.color, icon: c.icon })),
          ]}
        />
        {accounts.length > 0 && (
          <MultiSelect
            label="Accounts"
            allLabel="All accounts"
            selected={acctFilter}
            onChange={setAcctFilter}
            options={[
              ...accounts.map((a) => ({ value: a.id, label: a.name, color: a.color })),
              { value: "__none__", label: "No account" },
            ]}
          />
        )}

        {/* Saved filters */}
        {savedFilters.length > 0 && (
          <select
            className="input w-auto"
            value=""
            onChange={(e) => {
              const f = savedFilters.find((s) => s.name === e.target.value);
              if (f) applyFilter(f);
              e.currentTarget.value = "";
            }}
            aria-label="Apply a saved filter"
          >
            <option value="" disabled>★ Saved filters…</option>
            {savedFilters.map((f) => (
              <option key={f.name} value={f.name}>{f.name}</option>
            ))}
          </select>
        )}
        {hasActiveFilters && (
          <>
            <button onClick={saveCurrentFilter} className="btn-ghost h-9 text-sm" title="Save this filter combination">
              <BookmarkPlus size={15} /> <span className="hidden sm:inline">Save</span>
            </button>
            <button onClick={clearAllFilters} className="btn-ghost h-9 text-sm text-muted" title="Clear all filters">
              <X size={15} /> <span className="hidden sm:inline">Clear</span>
            </button>
          </>
        )}
        {savedFilters.length > 0 && (
          <ManageFilters filters={savedFilters} onDelete={(name) => persistFilters(savedFilters.filter((f) => f.name !== name))} />
        )}
      </div>

      {/* Bulk action bar (replaces the totals row while selecting) */}
      {selected.size > 0 ? (
        <div className="sticky top-16 z-20 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-brand/40 bg-brand/5 px-3 py-2">
          <span className="text-sm font-medium">{selected.size} selected</span>

          <select
            className="input h-8 w-auto text-xs"
            value=""
            disabled={pending}
            onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; runBulk((ids) => bulkSetCategoryAction(ids, v === "__none__" ? null : v)); }}
          >
            <option value="" disabled>Set category…</option>
            <option value="__none__">Uncategorized</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>

          <select
            className="input h-8 w-auto text-xs"
            value=""
            disabled={pending}
            onChange={(e) => { const v = e.target.value; e.currentTarget.value = ""; runBulk((ids) => bulkSetAccountAction(ids, v === "__none__" ? null : v)); }}
          >
            <option value="" disabled>Set account…</option>
            <option value="__none__">No account</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>

          <button onClick={() => runBulk((ids) => bulkSetClearedAction(ids, true))} disabled={pending} className="btn-ghost h-8 text-xs" title="Mark as cleared">
            <CheckCircle2 size={14} /> Cleared
          </button>
          <button onClick={() => runBulk((ids) => bulkSetClearedAction(ids, false))} disabled={pending} className="btn-ghost h-8 text-xs" title="Mark as expected/pending">
            <Clock size={14} /> Expected
          </button>
          <button onClick={bulkDelete} disabled={pending} className="btn-danger h-8 text-xs">
            <Trash2 size={14} /> Delete
          </button>
          <button onClick={clearSelection} className="btn-ghost ml-auto h-8 w-8 !p-0" title="Clear selection">
            <X size={15} />
          </button>
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-4 text-sm">
          <button onClick={toggleAll} disabled={filtered.length === 0} className="flex items-center gap-1.5 text-muted hover:text-text disabled:opacity-50">
            <Square size={14} /> Select
          </button>
          <span className="text-muted">{filtered.length} transactions</span>
          <span className="text-income">+{formatUSD(income)}</span>
          <span className="text-expense">−{formatUSD(expense)}</span>
          <span className="font-medium">Net {formatUSD(income - expense)}</span>
        </div>
      )}

      {bulkError && <p className="mb-2 text-sm text-expense">{bulkError}</p>}

      {/* Select-all header (only while selecting) */}
      {selected.size > 0 && filtered.length > 0 && (
        <button onClick={toggleAll} className="mb-2 flex items-center gap-1.5 px-1 text-xs text-muted hover:text-text">
          {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
          {allSelected ? "Deselect all" : `Select all ${filtered.length}`}
        </button>
      )}

      {/* List */}
      <div className="card divide-y divide-line">
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">No transactions match.</p>
        ) : (
          filtered.map((t) => {
            const cat = t.categoryId ? catById.get(t.categoryId) : undefined;
            const acct = t.accountId ? acctById.get(t.accountId) : undefined;
            const isSel = selected.has(t.id);
            const isFocus = t.id === highlightId;
            return (
              <div
                key={t.id}
                ref={isFocus ? focusRef : undefined}
                className={`flex items-center gap-2 px-2 transition-colors sm:px-3 ${
                  isFocus ? "bg-brand/15 ring-2 ring-inset ring-brand/40" : isSel ? "bg-brand/5" : ""
                }`}
              >
                <label className="flex h-full cursor-pointer items-center px-2 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onChange={() => toggle(t.id)}
                    aria-label={`Select ${t.description}`}
                  />
                </label>
                <button
                  onClick={() => setEditing(t)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-2 text-left hover:bg-surface2"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${cat?.color ?? "#64748b"}22`, color: cat?.color ?? "#64748b" }}
                  >
                    <CategoryIcon name={cat?.icon ?? "tag"} size={16} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">
                      {t.description}
                      {t.note && (
                        <StickyNote size={12} className="ml-1.5 inline align-middle text-muted" aria-label="Has a note" />
                      )}
                      {!t.cleared && (
                        <span className="ml-2 inline-flex items-center gap-1 align-middle text-[11px] text-warning">
                          <Clock size={11} /> {t.plaidTransactionId ? "pending" : "expected"}
                        </span>
                      )}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {t.date}
                      {cat ? ` · ${cat.name}` : ""}
                      {acct ? ` · ${acct.name}` : ""}
                      {t.note ? ` · ${t.note}` : ""}
                    </p>
                  </div>
                  <span className={`shrink-0 tabular-nums font-semibold ${t.type === "INCOME" ? "text-income" : "text-expense"}`}>
                    {t.type === "INCOME" ? "+" : "−"}
                    {formatUSD(t.amount)}
                  </span>
                </button>
              </div>
            );
          })
        )}
      </div>

      {adding && <TransactionModal open onClose={() => setAdding(false)} accounts={accounts} categories={categories} />}
      {editing && <TransactionModal open onClose={() => setEditing(null)} accounts={accounts} categories={categories} transaction={editing} />}
    </div>
  );
}

function csv(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Last day-of-month (zero-padded) for an ISO month like "2026-06-01". */
function endOfMonthDay(monthISO: string): string {
  const [y, m] = monthISO.slice(0, 7).split("-").map(Number);
  return String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
}

/** Small popover to delete saved filters. */
function ManageFilters({ filters, onDelete }: { filters: SavedFilter[]; onDelete: (name: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((o) => !o)} className="btn-ghost h-9 w-9 !p-0" title="Manage saved filters" aria-label="Manage saved filters">
        <Trash2 size={14} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-52 rounded-lg border border-line bg-surface p-1 shadow-lg">
            <p className="px-2 py-1 text-xs text-muted">Delete a saved filter</p>
            {filters.map((f) => (
              <button
                key={f.name}
                onClick={() => { onDelete(f.name); if (filters.length === 1) setOpen(false); }}
                className="flex w-full items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface2"
              >
                <span className="truncate">{f.name}</span>
                <Trash2 size={13} className="shrink-0 text-expense" />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
