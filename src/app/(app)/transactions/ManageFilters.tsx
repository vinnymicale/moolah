"use client";

import { useState } from "react";
import { Trash2 } from "lucide-react";
import type { SavedFilter } from "./transactions-utils";

/** Small popover to delete saved filters. */
export function ManageFilters({ filters, onDelete }: { filters: SavedFilter[]; onDelete: (name: string) => void }) {
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
