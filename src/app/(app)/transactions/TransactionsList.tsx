"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft, ChevronRight, Search, Plus, Download, Clock,
  CheckSquare, Square, Trash, Trash2, X, CheckCircle2, StickyNote, BookmarkPlus, ArrowLeftRight, Pencil,
} from "lucide-react";
import { TransactionModal } from "@/components/TransactionModal";
import { TrashDrawer } from "./TrashDrawer";
import { CategoryIcon } from "@/components/CategoryIcon";
import { MultiSelect } from "@/components/MultiSelect";
import { formatUSD } from "@/lib/money";
import { monthLabel, formatMonthDayYear } from "@/lib/dates";
import { useConfirmAction } from "@/lib/useConfirmAction";
import { Modal } from "@/components/Modal";
import {
  bulkSetCategoryAction, bulkSetAccountAction, bulkSetClearedAction, bulkDeleteTransactionsAction,
  pairTransfersAction, unpairTransferAction,
} from "@/actions/transactions";
import type { AccountDTO, CategoryDTO, TagDTO, TransactionDTO, TransactionsPageDTO } from "@/lib/queries";
import { categoryColor } from "@/lib/colors";
import { toggleInSet } from "@/lib/collections";
import { usePersistentState } from "@/lib/usePersistentState";
import { Amount } from "@/components/Amount";
import { ManageFilters } from "./ManageFilters";
import { endOfMonthDay, toSet, type SavedFilter, type StatusOpt, type TxnTypeOpt } from "./transactions-utils";

const SAVED_FILTERS_KEY = "txnSavedFilters";
const NO_FILTERS: SavedFilter[] = [];

export function TransactionsList({
  txnPage,
  accounts,
  categories,
  tags,
  range,
  rangeLabel,
  monthISO,
  prevMonthISO,
  nextMonthISO,
  initialSearch = "",
  initialTypes = "",
  initialStatuses = "",
  initialAccountId = "",
  initialCategoryId = "",
  initialTagId = "",
  focusId = "",
  customFrom = "",
  customTo = "",
}: {
  txnPage: TransactionsPageDTO;
  accounts: AccountDTO[];
  categories: CategoryDTO[];
  tags: TagDTO[];
  range: string;
  rangeLabel: string;
  monthISO: string;
  prevMonthISO: string;
  nextMonthISO: string;
  initialSearch?: string;
  initialTypes?: string;
  initialStatuses?: string;
  initialAccountId?: string;
  initialCategoryId?: string;
  initialTagId?: string;
  focusId?: string;
  customFrom?: string;
  customTo?: string;
}) {
  const router = useRouter();
  const focusRef = useRef<HTMLDivElement>(null);
  // Briefly highlight a transaction navigated to from global search: scroll it
  // into view and fade the highlight out after a moment. Initialised from the
  // prop so no synchronous state set is needed on mount.
  const [highlightId, setHighlightId] = useState(focusId);

  useEffect(() => {
    if (!focusId) return;
    focusRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    const t = setTimeout(() => setHighlightId(""), 2600);
    return () => clearTimeout(t);
  }, [focusId]);

  // Filters live in the URL so the server can filter and page the query; the
  // MultiSelects render straight from the props and every change navigates.
  // Only the search box keeps local state, debounced into router.replace.
  const typeFilter = useMemo(() => toSet(initialTypes), [initialTypes]);
  const statusFilter = useMemo(() => toSet(initialStatuses), [initialStatuses]);
  const catFilter = useMemo(() => toSet(initialCategoryId), [initialCategoryId]);
  const acctFilter = useMemo(() => toSet(initialAccountId), [initialAccountId]);
  const tagFilter = useMemo(() => toSet(initialTagId), [initialTagId]);
  const [search, setSearch] = useState(initialSearch);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // Keep the box in step with the URL (back button, saved filters) but never
  // clobber text the user is actively typing.
  useEffect(() => {
    if (document.activeElement === searchInputRef.current) return;
    setSearch(initialSearch);
  }, [initialSearch]);
  const [editing, setEditing] = useState<TransactionDTO | null>(null);
  const [adding, setAdding] = useState(false);
  const [trashOpen, setTrashOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkError, setBulkError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const items = txnPage.items;

  // Query-string helpers. currentParams reflects the URL this page was
  // rendered from; urlWith applies overrides (null/"" deletes a key) and drops
  // the page param, since any filter or range change restarts at page 1.
  const currentParams = () => {
    const p: Record<string, string> = {};
    if (range === "custom") {
      p.range = "custom";
      p.from = customFrom;
      p.to = customTo;
    } else if (range === "month") p.m = monthISO.slice(0, 7);
    else p.range = range;
    if (initialSearch) p.q = initialSearch;
    if (initialTypes) p.type = initialTypes;
    if (initialStatuses) p.status = initialStatuses;
    if (initialCategoryId) p.category = initialCategoryId;
    if (initialAccountId) p.account = initialAccountId;
    if (initialTagId) p.tag = initialTagId;
    return p;
  };
  const urlWith = (overrides: Record<string, string | null>, path = "/transactions") => {
    const p = currentParams();
    for (const [k, v] of Object.entries(overrides)) {
      if (v === null || v === "") delete p[k];
      else p[k] = v;
    }
    const qs = new URLSearchParams(p).toString();
    return qs ? `${path}?${qs}` : path;
  };

  // Debounce typed search into the URL. Skipped while the input matches the
  // URL so applying a saved filter or navigating doesn't fire a redundant
  // replace.
  useEffect(() => {
    if (search.trim() === initialSearch) return;
    const t = setTimeout(() => {
      router.replace(urlWith({ q: search.trim() }), { scroll: false });
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, initialSearch]);

  const setTypeFilter = (s: Set<string>) => router.push(urlWith({ type: [...s].join(",") }));
  const setStatusFilter = (s: Set<string>) => router.push(urlWith({ status: [...s].join(",") }));
  const setCatFilter = (s: Set<string>) => router.push(urlWith({ category: [...s].join(",") }));
  const setAcctFilter = (s: Set<string>) => router.push(urlWith({ account: [...s].join(",") }));
  const setTagFilter = (s: Set<string>) => router.push(urlWith({ tag: [...s].join(",") }));

  // Saved filters (named filter combos), persisted in localStorage.
  const [savedFilters, persistFilters] = usePersistentState<SavedFilter[]>(SAVED_FILTERS_KEY, NO_FILTERS);
  const applyFilter = (f: SavedFilter) => {
    setSearch(f.search);
    router.push(urlWith({
      q: f.search.trim(),
      type: f.types.join(","),
      status: f.statuses.join(","),
      category: f.cats.join(","),
      account: f.accts.join(","),
      tag: (f.tags ?? []).join(",") || null,
    }));
  };
  const [namingFilter, setNamingFilter] = useState(false);
  const [filterName, setFilterName] = useState("");
  const saveCurrentFilter = () => {
    const name = filterName.trim();
    if (!name) return;
    setNamingFilter(false);
    setFilterName("");
    const next = [
      ...savedFilters.filter((f) => f.name !== name),
      {
        name,
        search: search.trim(),
        types: [...typeFilter] as TxnTypeOpt[],
        statuses: [...statusFilter] as StatusOpt[],
        cats: [...catFilter],
        accts: [...acctFilter],
        tags: [...tagFilter],
      },
    ];
    persistFilters(next);
  };
  const hasActiveFilters = !!search.trim() || typeFilter.size > 0 || statusFilter.size > 0 || catFilter.size > 0 || acctFilter.size > 0 || tagFilter.size > 0;
  const clearAllFilters = () => {
    setSearch("");
    router.push(urlWith({ q: null, type: null, status: null, category: null, account: null, tag: null }));
  };

  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);
  const acctById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);

  const changeRange = (value: string) => {
    const dropRange = { m: null, range: null, from: null, to: null } as const;
    if (value === "custom") {
      // Default the custom window to the current month until the user edits it.
      const from = customFrom || `${monthISO.slice(0, 7)}-01`;
      const to = customTo || monthISO.slice(0, 7) + "-" + endOfMonthDay(monthISO);
      router.push(urlWith({ ...dropRange, range: "custom", from, to }));
    } else if (value === "month") router.push(urlWith({ ...dropRange, m: monthISO.slice(0, 7) }));
    else router.push(urlWith({ ...dropRange, range: value }));
  };
  const applyCustom = (from: string, to: string) => {
    if (!from || !to) return;
    const lo = from <= to ? from : to;
    const hi = from <= to ? to : from;
    router.push(urlWith({ m: null, range: "custom", from: lo, to: hi }));
  };

  const allSelected = items.length > 0 && items.every((t) => selected.has(t.id));
  const toggle = (id: string) => setSelected((prev) => toggleInSet(prev, id));
  // Shift-click selects the whole span between the last-toggled row and this
  // one, matching the click target's new state (Gmail-style).
  const lastToggledId = useRef<string | null>(null);
  const selectClick = (id: string, shiftKey: boolean) => {
    const anchor = lastToggledId.current;
    lastToggledId.current = id;
    if (shiftKey && anchor && anchor !== id) {
      const ids = items.map((t) => t.id);
      const from = ids.indexOf(anchor);
      const to = ids.indexOf(id);
      if (from >= 0 && to >= 0) {
        const [lo, hi] = from < to ? [from, to] : [to, from];
        const adding = !selected.has(id);
        setSelected((prev) => {
          const next = new Set(prev);
          for (const spanId of ids.slice(lo, hi + 1)) {
            if (adding) next.add(spanId);
            else next.delete(spanId);
          }
          return next;
        });
        return;
      }
    }
    toggle(id);
  };
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(items.map((t) => t.id)));
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

  const { armed: deleteArmed, trigger: bulkDelete } = useConfirmAction(() =>
    runBulk((ids) => bulkDeleteTransactionsAction(ids)),
  );

  // The export route re-runs the same range + filters server-side, so the CSV
  // covers every matching row, not just the loaded page.
  const exportCsv = () => {
    window.location.href = urlWith({}, "/transactions/export");
  };

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          {range === "month" ? (
            <>
              <Link href={urlWith({ m: prevMonthISO.slice(0, 7) })} className="btn-ghost h-9 w-9 p-0!" aria-label="Previous">
                <ChevronLeft size={18} />
              </Link>
              <span className="min-w-40 text-center font-semibold">{monthLabel(new Date(`${monthISO}T00:00:00Z`))}</span>
              <Link href={urlWith({ m: nextMonthISO.slice(0, 7) })} className="btn-ghost h-9 w-9 p-0!" aria-label="Next">
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
          <button onClick={() => setTrashOpen(true)} className="btn-ghost h-9 w-9 p-0!" title="Recently deleted">
            <Trash size={15} />
          </button>
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
          <input ref={searchInputRef} data-search="true" className="input pl-9" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
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
        {tags.length > 0 && (
          <MultiSelect
            label="Tags"
            allLabel="All tags"
            options={tags.map((t) => ({ value: t.id, label: t.name, color: t.color }))}
            selected={tagFilter}
            onChange={setTagFilter}
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
            <button onClick={() => setNamingFilter(true)} className="btn-ghost h-9 text-sm" title="Save this filter combination">
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
          {selected.size === 2 && (
            <button
              onClick={() => { const [a, b] = [...selected]; runBulk(() => pairTransfersAction(a, b)); }}
              disabled={pending}
              className="btn-ghost h-8 text-xs"
              title="Link these two as the two sides of a transfer (excluded from totals)"
            >
              <ArrowLeftRight size={14} /> Link as transfer
            </button>
          )}
          {selected.size === 1 && items.find((t) => selected.has(t.id))?.isTransfer && (
            <button
              onClick={() => { const [id] = [...selected]; runBulk(() => unpairTransferAction(id)); }}
              disabled={pending}
              className="btn-ghost h-8 text-xs"
              title="Unlink this transfer pair"
            >
              <ArrowLeftRight size={14} /> Unlink transfer
            </button>
          )}
          <button onClick={bulkDelete} disabled={pending} className="btn-danger h-8 text-xs" title="Moves to Recently deleted, where it can be restored">
            <Trash2 size={14} /> {deleteArmed ? `Move ${selected.size} to trash?` : "Delete"}
          </button>
          <button onClick={clearSelection} className="btn-ghost ml-auto h-8 w-8 p-0!" title="Clear selection">
            <X size={15} />
          </button>
        </div>
      ) : (
        <div className="mb-3 flex items-center gap-4 text-sm">
          <button onClick={toggleAll} disabled={items.length === 0} className="flex items-center gap-1.5 text-muted hover:text-text disabled:opacity-50">
            <Square size={14} /> Select
          </button>
          <span className="text-muted">{txnPage.total} transactions</span>
          <span className="text-income">+{formatUSD(txnPage.income)}</span>
          <span className="text-expense">-{formatUSD(txnPage.expense)}</span>
          <span className="font-medium">Net {formatUSD(txnPage.income - txnPage.expense)}</span>
        </div>
      )}

      {bulkError && <p className="mb-2 text-sm text-expense">{bulkError}</p>}

      {/* Select-all header (only while selecting) */}
      {selected.size > 0 && items.length > 0 && (
        <button onClick={toggleAll} className="mb-2 flex items-center gap-1.5 px-1 text-xs text-muted hover:text-text">
          {allSelected ? <CheckSquare size={14} /> : <Square size={14} />}
          {allSelected ? "Deselect all" : `Select all ${items.length} on this page`}
        </button>
      )}

      {/* List */}
      <div className="card divide-y divide-line">
        {items.length === 0 ? (
          <p className="px-4 py-10 text-center text-sm text-muted">No transactions match.</p>
        ) : (
          items.map((t) => {
            const cat = t.categoryId ? catById.get(t.categoryId) : undefined;
            const acct = t.accountId ? acctById.get(t.accountId) : undefined;
            const isSel = selected.has(t.id);
            const isFocus = t.id === highlightId;
            return (
              <div
                key={t.id}
                ref={isFocus ? focusRef : undefined}
                className={`group flex items-center gap-2 px-2 transition-colors sm:px-3 ${
                  isFocus ? "bg-brand/15 ring-2 ring-inset ring-brand/40" : isSel ? "bg-brand/5" : "hover:bg-surface2/60"
                }`}
              >
                <label className="flex h-full cursor-pointer items-center px-2 py-3" onClick={(e) => e.stopPropagation()}>
                  <input
                    type="checkbox"
                    checked={isSel}
                    onClick={(e) => selectClick(t.id, e.shiftKey)}
                    onChange={() => {}}
                    aria-label={`Select ${t.description}`}
                  />
                </label>
                <button
                  onClick={() => setEditing(t)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 pr-2 text-left"
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
                    style={{ backgroundColor: `${categoryColor(cat)}22`, color: categoryColor(cat) }}
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
                      {t.isTransfer && (
                        <span className="ml-2 inline-flex items-center gap-1 align-middle text-[11px] text-muted" title="Transfer pair - excluded from totals">
                          <ArrowLeftRight size={11} /> transfer
                        </span>
                      )}
                      {t.tags.map((tag) => (
                        <span
                          key={tag.id}
                          className="ml-1 inline-flex items-center gap-1 rounded-full border border-line px-1.5 py-px align-middle text-[10px] font-normal text-muted"
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: tag.color }} />
                          {tag.name}
                        </span>
                      ))}
                    </p>
                    <p className="truncate text-xs text-muted">
                      {formatMonthDayYear(t.date)}
                      {cat ? ` · ${cat.name}` : ""}
                      {acct ? ` · ${acct.name}` : ""}
                      {t.note ? ` · ${t.note}` : ""}
                    </p>
                  </div>
                  <Amount type={t.type} amount={t.amount} isTransfer={t.isTransfer} className="shrink-0 font-semibold" />
                  <Pencil
                    size={13}
                    className="hidden shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 sm:block"
                    aria-hidden="true"
                  />
                </button>
              </div>
            );
          })
        )}
      </div>

      {/* Pagination */}
      {txnPage.pageCount > 1 && (
        <div className="mt-4 flex items-center justify-center gap-2 text-sm">
          {txnPage.page > 1 ? (
            <Link href={urlWith({ page: String(txnPage.page - 1) })} className="btn-ghost h-9" aria-label="Previous page">
              <ChevronLeft size={16} /> Prev
            </Link>
          ) : (
            <span className="btn-ghost h-9 opacity-50" aria-hidden="true"><ChevronLeft size={16} /> Prev</span>
          )}
          <span className="text-muted">Page {txnPage.page} of {txnPage.pageCount}</span>
          {txnPage.page < txnPage.pageCount ? (
            <Link href={urlWith({ page: String(txnPage.page + 1) })} className="btn-ghost h-9" aria-label="Next page">
              Next <ChevronRight size={16} />
            </Link>
          ) : (
            <span className="btn-ghost h-9 opacity-50" aria-hidden="true">Next <ChevronRight size={16} /></span>
          )}
        </div>
      )}

      <Modal open={namingFilter} onClose={() => setNamingFilter(false)} title="Save filter" widthClass="max-w-sm">
        <form
          onSubmit={(e) => { e.preventDefault(); saveCurrentFilter(); }}
          className="space-y-3"
        >
          <input
            className="input"
            placeholder='e.g. "Uber this year"'
            value={filterName}
            onChange={(e) => setFilterName(e.target.value)}
            aria-label="Filter name"
          />
          <p className="text-xs text-muted">Saving with an existing name replaces that filter.</p>
          <div className="flex justify-end gap-2">
            <button type="button" onClick={() => setNamingFilter(false)} className="btn-ghost h-9">Cancel</button>
            <button type="submit" disabled={!filterName.trim()} className="btn-primary h-9">Save</button>
          </div>
        </form>
      </Modal>

      {adding && <TransactionModal open onClose={() => setAdding(false)} accounts={accounts} categories={categories} />}
      {editing && <TransactionModal open onClose={() => setEditing(null)} accounts={accounts} categories={categories} transaction={editing} />}
      <TrashDrawer open={trashOpen} onClose={() => setTrashOpen(false)} accounts={accounts} categories={categories} />
    </div>
  );
}
