"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { toggleInSet } from "@/lib/collections";
import type { AccountDTO } from "@/lib/queries";
import type { AccountType } from "@/generated/prisma/enums";

/**
 * Coarse buckets the calendar groups accounts into, so the filter shows a couple
 * of dropdowns ("Bank", "Credit cards", ...) instead of one per fine-grained
 * AccountType. Each bucket maps to one popover of per-account checkboxes.
 */
const GROUPS: { key: string; label: string; types: AccountType[] }[] = [
  { key: "bank", label: "Bank", types: ["CHECKING", "SAVINGS", "CASH"] },
  { key: "credit", label: "Credit cards", types: ["CREDIT_CARD"] },
  { key: "loan", label: "Loans", types: ["LOAN"] },
  { key: "invest", label: "Investments", types: ["RETIREMENT", "INVESTMENT"] },
];

/** Anything not covered above falls into a single "Other" dropdown. */
const groupFor = (type: AccountType): string =>
  GROUPS.find((g) => g.types.includes(type))?.key ?? "other";

/**
 * Per-account-type filter dropdowns. Each group with at least one account
 * renders a compact trigger showing "enabled/total" plus a popover of
 * checkboxes (select-all and one per account, with the account's color swatch).
 * Accounts start fully enabled; toggling off filters them out of the calendar.
 */
export function AccountFilter({
  accounts,
  enabledAccountIds,
  onChange,
}: {
  accounts: AccountDTO[];
  enabledAccountIds: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const grouped = useMemo(() => {
    const byKey = new Map<string, { label: string; accounts: AccountDTO[] }>();
    for (const a of accounts) {
      const key = groupFor(a.type);
      const label = GROUPS.find((g) => g.key === key)?.label ?? "Other";
      const bucket = byKey.get(key) ?? { label, accounts: [] };
      bucket.accounts.push(a);
      byKey.set(key, bucket);
    }
    // Keep a stable order: defined groups first, then "Other".
    const order = [...GROUPS.map((g) => g.key), "other"];
    return order.flatMap((k) => (byKey.has(k) ? [{ key: k, ...byKey.get(k)! }] : []));
  }, [accounts]);

  return (
    <>
      {grouped.map((g) => (
        <GroupDropdown
          key={g.key}
          label={g.label}
          accounts={g.accounts}
          enabledAccountIds={enabledAccountIds}
          onChange={onChange}
        />
      ))}
    </>
  );
}

function GroupDropdown({
  label,
  accounts,
  enabledAccountIds,
  onChange,
}: {
  label: string;
  accounts: AccountDTO[];
  enabledAccountIds: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const enabledCount = accounts.reduce((n, a) => n + (enabledAccountIds.has(a.id) ? 1 : 0), 0);
  const allOn = enabledCount === accounts.length;
  const noneOn = enabledCount === 0;

  const toggleOne = (id: string) => onChange(toggleInSet(enabledAccountIds, id));

  const toggleAll = () => {
    const next = new Set(enabledAccountIds);
    if (allOn) for (const a of accounts) next.delete(a.id);
    else for (const a of accounts) next.add(a.id);
    onChange(next);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors ${
          noneOn ? "border-line bg-surface2 text-muted" : "border-brand/40 bg-brand/10 text-brand"
        }`}
        aria-expanded={open}
      >
        <span>{label}</span>
        <span className="tabular-nums opacity-70">{enabledCount}/{accounts.length}</span>
        <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="absolute left-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto rounded-lg border border-line bg-surface p-1 shadow-lg">
          <button
            type="button"
            onClick={toggleAll}
            className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface2"
          >
            <span
              className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                allOn ? "border-brand bg-brand text-brand-fg" : "border-line"
              }`}
            >
              {allOn && <Check size={11} />}
            </span>
            <span className="flex-1 font-medium text-muted">Select all</span>
          </button>
          <ul>
            {accounts.map((a) => {
              const checked = enabledAccountIds.has(a.id);
              return (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => toggleOne(a.id)}
                    className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-surface2"
                  >
                    <span
                      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                        checked ? "border-brand bg-brand text-brand-fg" : "border-line"
                      }`}
                    >
                      {checked && <Check size={11} />}
                    </span>
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: a.color }} />
                    <span className="flex-1 truncate">{a.name}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
