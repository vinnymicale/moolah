"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, CornerDownLeft } from "lucide-react";
import { searchTransactionsAction, type SearchHit } from "@/actions/transactions";
import { CategoryIcon } from "@/components/CategoryIcon";
import { formatWeekdayMonthDayYear } from "@/lib/dates";
import { Amount } from "@/components/Amount";
import { categoryColor } from "@/lib/colors";
import { filterCommands, type Command } from "@/lib/commands";
import type { AccountDTO, CategoryDTO } from "@/lib/queries";

// Rendered only while open (mounted/unmounted by the parent), so state starts
// fresh each time and there's no open/close reset effect.
export function CommandPalette({
  onClose,
  commands = [],
  categories,
  accounts,
}: {
  onClose: () => void;
  // Navigation + quick-action entries the parent wires up (see lib/commands).
  commands?: Command[];
  categories: CategoryDTO[];
  accounts: AccountDTO[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [rawActive, setActive] = useState(0);
  const [searched, setSearched] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const catById = new Map(categories.map((c) => [c.id, c]));
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const queryLongEnough = query.trim().length >= 2;

  // Commands are filtered client-side and shown immediately; transactions need a
  // debounced server round-trip and only kick in at >=2 chars.
  const matchedCommands = useMemo(() => filterCommands(commands, query), [commands, query]);

  // Transactions only matter once the query is long enough; below that we ignore
  // any (possibly stale) hits rather than clearing them in an effect.
  const visibleHits = useMemo(
    () => (queryLongEnough ? hits : []),
    [queryLongEnough, hits],
  );

  // A flat, ordered list of selectable rows so arrow keys can move across both
  // the command group and the transaction group as one list.
  const rows = useMemo(
    () => [
      ...matchedCommands.map((cmd) => ({ kind: "command" as const, cmd })),
      ...visibleHits.map((hit) => ({ kind: "txn" as const, hit })),
    ],
    [matchedCommands, visibleHits],
  );

  // Clamp at render time rather than in an effect (which would trip
  // set-state-in-effect); the value used for keyboard nav is always in range.
  const active = Math.min(rawActive, Math.max(0, rows.length - 1));

  // Focus the input once the palette has mounted.
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Debounced server search. Short queries simply don't search; stale hits are
  // ignored via `visibleHits` rather than cleared here (clearing state in an
  // effect trips react-hooks/set-state-in-effect).
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        const results = await searchTransactionsAction(q);
        setHits(results);
        setSearched(true);
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const goTxn = (hit: SearchHit) => {
    onClose();
    // Navigate to the transaction's month and ask the list to highlight it.
    router.push(`/transactions?m=${hit.date.slice(0, 7)}&focus=${hit.id}`);
  };

  const runRow = (i: number) => {
    const row = rows[i];
    if (!row) return;
    if (row.kind === "command") {
      onClose();
      row.cmd.run();
    } else {
      goTxn(row.hit);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, rows.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runRow(active);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  const showTxnGroup = queryLongEnough;
  const commandCount = matchedCommands.length;
  const nothingAtAll =
    rows.length === 0 && (!queryLongEnough || (searched && !pending));

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-md" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-2xl border border-line bg-surface shadow-overlay">
        {/* Search input */}
        <div className="flex items-center gap-2 border-b border-line px-4">
          {pending ? (
            <Loader2 size={18} className="shrink-0 animate-spin text-muted" />
          ) : (
            <Search size={18} className="shrink-0 text-muted" />
          )}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Jump to a page, run an action, or search transactions…"
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-muted"
          />
          <kbd className="hidden shrink-0 rounded border border-line bg-surface2 px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {nothingAtAll ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              No matches for “{query.trim()}”.
            </p>
          ) : (
            <ul className="py-1">
              {matchedCommands.length > 0 && (
                <li className="px-4 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Actions
                </li>
              )}
              {matchedCommands.map((cmd, i) => {
                const Icon = cmd.icon;
                return (
                  <li key={cmd.id}>
                    <button
                      onClick={() => runRow(i)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                        i === active ? "bg-surface2" : ""
                      }`}
                    >
                      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface2 text-muted">
                        {Icon ? <Icon size={15} /> : <Search size={15} />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{cmd.label}</p>
                        {cmd.hint && <p className="truncate text-xs text-muted">{cmd.hint}</p>}
                      </div>
                      {i === active && <CornerDownLeft size={13} className="shrink-0 text-muted" />}
                    </button>
                  </li>
                );
              })}

              {showTxnGroup && visibleHits.length > 0 && (
                <li className="px-4 pt-3 pb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">
                  Transactions
                </li>
              )}
              {visibleHits.map((hit, j) => {
                const i = commandCount + j;
                const cat = hit.categoryId ? catById.get(hit.categoryId) : undefined;
                const acct = hit.accountId ? acctById.get(hit.accountId) : undefined;
                return (
                  <li key={hit.id}>
                    <button
                      onClick={() => runRow(i)}
                      onMouseEnter={() => setActive(i)}
                      className={`flex w-full items-center gap-3 px-4 py-2 text-left ${
                        i === active ? "bg-surface2" : ""
                      }`}
                    >
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                        style={{ backgroundColor: `${categoryColor(cat)}22`, color: categoryColor(cat) }}
                      >
                        <CategoryIcon name={cat?.icon ?? "tag"} size={15} />
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{hit.description}</p>
                        <p className="truncate text-xs text-muted">
                          {formatWeekdayMonthDayYear(hit.date)}
                          {cat ? ` · ${cat.name}` : ""}
                          {acct ? ` · ${acct.name}` : ""}
                        </p>
                      </div>
                      <Amount type={hit.type} amount={hit.amount} className="shrink-0 text-sm font-semibold" />
                      {i === active && <CornerDownLeft size={13} className="shrink-0 text-muted" />}
                    </button>
                  </li>
                );
              })}

              {showTxnGroup && searched && visibleHits.length === 0 && !pending && (
                <li className="px-4 py-3 text-center text-xs text-muted">
                  No transactions match “{query.trim()}”.
                </li>
              )}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-muted">
          <span className="flex items-center gap-1"><kbd className="rounded border border-line bg-surface2 px-1 font-mono">↑↓</kbd> navigate</span>
          <span className="flex items-center gap-1"><kbd className="rounded border border-line bg-surface2 px-1 font-mono">↵</kbd> select</span>
          {!queryLongEnough && <span className="ml-auto">Type 2+ characters to search transactions</span>}
        </div>
      </div>
    </div>
  );
}
