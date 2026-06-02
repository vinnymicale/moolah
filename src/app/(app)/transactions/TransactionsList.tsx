"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Search, Plus, Download, Clock } from "lucide-react";
import { TransactionModal } from "@/components/TransactionModal";
import { CategoryIcon } from "@/components/CategoryIcon";
import { formatUSD } from "@/lib/money";
import { monthLabel } from "@/lib/dates";
import type { AccountDTO, CategoryDTO, TransactionDTO } from "@/lib/queries";

export function TransactionsList({
  transactions,
  accounts,
  categories,
  monthISO,
  prevMonthISO,
  nextMonthISO,
}: {
  transactions: TransactionDTO[];
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  monthISO: string;
  prevMonthISO: string;
  nextMonthISO: string;
}) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"ALL" | "INCOME" | "EXPENSE">("ALL");
  const [catFilter, setCatFilter] = useState("");
  const [editing, setEditing] = useState<TransactionDTO | null>(null);
  const [adding, setAdding] = useState(false);

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const acctById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const filtered = transactions.filter((t) => {
    if (typeFilter !== "ALL" && t.type !== typeFilter) return false;
    if (catFilter && t.categoryId !== catFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const cat = t.categoryId ? catById.get(t.categoryId)?.name ?? "" : "";
      if (!t.description.toLowerCase().includes(q) && !cat.toLowerCase().includes(q)) return false;
    }
    return true;
  });

  const income = filtered.filter((t) => t.type === "INCOME").reduce((s, t) => s + t.amount, 0);
  const expense = filtered.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0);

  const exportCsv = () => {
    const header = ["Date", "Type", "Amount", "Description", "Category", "Account", "Cleared"];
    const rows = filtered.map((t) => [
      t.date,
      t.type,
      String(t.amount),
      csv(t.description),
      csv(t.categoryId ? catById.get(t.categoryId)?.name ?? "" : ""),
      csv(t.accountId ? acctById.get(t.accountId)?.name ?? "" : ""),
      t.cleared ? "yes" : "no",
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
          <Link href={`/transactions?m=${prevMonthISO.slice(0, 7)}`} className="btn-ghost h-9 w-9 !p-0" aria-label="Previous">
            <ChevronLeft size={18} />
          </Link>
          <span className="min-w-40 text-center font-semibold">{monthLabel(new Date(`${monthISO}T00:00:00Z`))}</span>
          <Link href={`/transactions?m=${nextMonthISO.slice(0, 7)}`} className="btn-ghost h-9 w-9 !p-0" aria-label="Next">
            <ChevronRight size={18} />
          </Link>
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
          <input className="input pl-9" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <select className="input w-auto" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as typeof typeFilter)}>
          <option value="ALL">All types</option>
          <option value="EXPENSE">Expenses</option>
          <option value="INCOME">Income</option>
        </select>
        <select className="input w-auto" value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {/* Totals */}
      <div className="mb-3 flex gap-4 text-sm">
        <span className="text-muted">{filtered.length} transactions</span>
        <span className="text-income">+{formatUSD(income)}</span>
        <span className="text-expense">−{formatUSD(expense)}</span>
        <span className="font-medium">Net {formatUSD(income - expense)}</span>
      </div>

      {/* List */}
      <div className="card divide-y divide-line">
        {filtered.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">No transactions match.</p>
        ) : (
          filtered.map((t) => {
            const cat = t.categoryId ? catById.get(t.categoryId) : undefined;
            const acct = t.accountId ? acctById.get(t.accountId) : undefined;
            return (
              <button
                key={t.id}
                onClick={() => setEditing(t)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-surface2"
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
                  </p>
                </div>
                <span className={`shrink-0 tabular-nums font-semibold ${t.type === "INCOME" ? "text-income" : "text-expense"}`}>
                  {t.type === "INCOME" ? "+" : "−"}
                  {formatUSD(t.amount)}
                </span>
              </button>
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
