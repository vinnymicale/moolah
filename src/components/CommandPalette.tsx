"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2, CornerDownLeft } from "lucide-react";
import { searchTransactionsAction, type SearchHit } from "@/actions/transactions";
import { CategoryIcon } from "@/components/CategoryIcon";
import { formatWeekdayMonthDayYear } from "@/lib/dates";
import { Amount } from "@/components/Amount";
import { categoryColor } from "@/lib/colors";
import type { AccountDTO, CategoryDTO } from "@/lib/queries";

// Rendered only while open (mounted/unmounted by the parent), so state starts
// fresh each time and there's no open/close reset effect.
export function CommandPalette({
  onClose,
  categories,
  accounts,
}: {
  onClose: () => void;
  categories: CategoryDTO[];
  accounts: AccountDTO[];
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const [searched, setSearched] = useState(false);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);

  const catById = new Map(categories.map((c) => [c.id, c]));
  const acctById = new Map(accounts.map((a) => [a.id, a]));
  const queryLongEnough = query.trim().length >= 2;

  // Focus the input once the palette has mounted.
  useEffect(() => {
    requestAnimationFrame(() => inputRef.current?.focus());
  }, []);

  // Debounced server search. Short queries simply don't search; the render gates
  // on the query length, so no state needs clearing synchronously here.
  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const handle = setTimeout(() => {
      startTransition(async () => {
        const results = await searchTransactionsAction(q);
        setHits(results);
        setActive(0);
        setSearched(true);
      });
    }, 200);
    return () => clearTimeout(handle);
  }, [query]);

  const go = (hit: SearchHit) => {
    onClose();
    // Navigate to the transaction's month and ask the list to highlight it.
    router.push(`/transactions?m=${hit.date.slice(0, 7)}&focus=${hit.id}`);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, hits.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const hit = hits[active];
      if (hit) go(hit);
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center p-4 pt-[12vh]">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl border border-line bg-surface shadow-2xl">
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
            placeholder="Search all transactions by name, note, or amount…"
            className="w-full bg-transparent py-3.5 text-sm outline-none placeholder:text-muted"
          />
          <kbd className="hidden shrink-0 rounded border border-line bg-surface2 px-1.5 py-0.5 font-mono text-[10px] text-muted sm:inline">
            esc
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-[50vh] overflow-y-auto">
          {!queryLongEnough ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              Type at least 2 characters to search your entire history.
            </p>
          ) : searched && hits.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              No transactions match “{query.trim()}”.
            </p>
          ) : (
            <ul className="py-1">
              {hits.map((hit, i) => {
                const cat = hit.categoryId ? catById.get(hit.categoryId) : undefined;
                const acct = hit.accountId ? acctById.get(hit.accountId) : undefined;
                return (
                  <li key={hit.id}>
                    <button
                      onClick={() => go(hit)}
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
            </ul>
          )}
        </div>

        {queryLongEnough && hits.length > 0 && (
          <div className="flex items-center gap-3 border-t border-line px-4 py-2 text-[11px] text-muted">
            <span className="flex items-center gap-1"><kbd className="rounded border border-line bg-surface2 px-1 font-mono">↑↓</kbd> navigate</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-line bg-surface2 px-1 font-mono">↵</kbd> open</span>
            <span className="ml-auto">{hits.length} result{hits.length === 1 ? "" : "s"}</span>
          </div>
        )}
      </div>
    </div>
  );
}
