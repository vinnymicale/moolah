"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, ChevronRight, Search, Plus, Download, Clock,
  CheckSquare, Square, Trash2, X, CheckCircle2, StickyNote,
} from "lucide-react";
import { TransactionModal } from "@/components/TransactionModal";
import { CategoryIcon } from "@/components/CategoryIcon";
import { formatUSD } from "@/lib/money";
import { monthLabel } from "@/lib/dates";
import {
  bulkSetCategoryAction, bulkSetAccountAction, bulkSetClearedAction, bulkDeleteTransactionsAction,
} from "@/actions/transactions";
import type { AccountDTO, CategoryDTO, TransactionDTO } from "@/lib/queries";

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
}) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "INCOME" | "EXPENSE">("ALL");
  const [statusFilter, setStatusFilter] = useState<"ALL" | "CLEARED" | "PENDING">("ALL");
  const [catFilter, setCatFilter] = useState(initialCategoryId);
  const [acctFilter, setAcctFilter] = useState(initialAccountId);
  const [editing, setEditing] = useState<TransactionDTO | null>(null);
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const acctById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const filtered = transactions.filter((t) => {
    if (typeFilter !== "ALL" && t.type !== typeFilter) return false;
    if (statusFilter === "CLEARED" && !t.cleared) return false;
    if (statusFilter === "PENDING" && t.cleared) return false;
    if (catFilter && t.categoryId !== catFilter) return false;
    if (acctFilter && t.accountId !== (acctFilter === "__none__" ? null : acctFilter)) return false;
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

  // Preserve the account & category filters across range/month navigation.
  const acctQS = acctFilter && acctFilter !== "__none__" ? `&account=${acctFilter}` : "";
  const catQS = catFilter ? `&category=${catFilter}` : "";
  const filterQS = `${acctQS}${catQS}`;
  const changeRange = (value: string) => {
    if (value === "month") router.push(`/transactions?m=${monthISO.slice(0, 7)}${filterQS}`);
    else router.push(`/transactions?range=${value}${filterQS}`);
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
          </select>
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
        <select className="input w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
          <option value="ALL">All types</option>
          <option value="EXPENSE">Expenses</option>
          <option value="INCOME">Income</option>
        </select>
        <select className="input w-auto" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}>
          <option value="ALL">All status</option>
          <option value="CLEARED">Cleared</option>
          <option value="PENDING">Pending</option>
        </select>
        <select className="input w-auto" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {accounts.length > 0 && (
          <select className="input w-auto" value={acctFilter} onChange={(e) => setAcctFilter(e.target.value)}>
            <option value="">All accounts</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
            <option value="__none__">No account</option>
          </select>
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
            return (
              <div key={t.id} className={`flex items-center gap-2 px-2 sm:px-3 ${isSel ? "bg-brand/5" : ""}`}>
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
                          <Clock size={11} /> expected
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
