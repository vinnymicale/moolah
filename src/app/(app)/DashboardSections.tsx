"use client";

import { useMemo, useRef, useState } from "react";
import { GripVertical, LayoutGrid, Check, RotateCcw } from "lucide-react";
import { usePersistentState } from "@/lib/usePersistentState";

const STORAGE_KEY = "dashboardOrder";

export interface DashboardSection {
  id: string;
  /** Pre-rendered card markup (built on the server). */
  node: React.ReactNode;
}

/**
 * Renders the dashboard's stacked cards in a user-customisable order. Toggle
 * "Arrange" to drag cards into a new order; the order persists per browser.
 */
export function DashboardSections({ sections }: { sections: DashboardSection[] }) {
  const defaultOrder = useMemo(() => sections.map((s) => s.id), [sections]);
  const byId = new Map(sections.map((s) => [s.id, s.node]));

  const [order, persist] = usePersistentState<string[]>(STORAGE_KEY, defaultOrder);
  const [editing, setEditing] = useState(false);
  const [overId, setOverId] = useState<string | null>(null);
  const dragId = useRef<string | null>(null);

  // Stored order, minus sections that no longer exist, plus any new ones appended.
  const effective = [
    ...order.filter((id) => byId.has(id)),
    ...defaultOrder.filter((id) => !order.includes(id)),
  ];
  const customized = effective.join() !== defaultOrder.join();

  const handleDrop = (targetId: string) => {
    const src = dragId.current;
    dragId.current = null;
    setOverId(null);
    if (!src || src === targetId) return;
    const next = [...effective];
    const from = next.indexOf(src);
    const to = next.indexOf(targetId);
    if (from < 0 || to < 0) return;
    next.splice(from, 1);
    next.splice(to, 0, src);
    persist(next);
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-end gap-2">
        {editing && customized && (
          <button onClick={() => persist(defaultOrder)} className="btn-ghost h-8 text-xs">
            <RotateCcw size={13} /> Reset
          </button>
        )}
        <button onClick={() => setEditing((v) => !v)} className="btn-ghost h-8 text-xs">
          {editing ? <><Check size={14} /> Done</> : <><LayoutGrid size={14} /> Arrange</>}
        </button>
      </div>

      <div className="stagger space-y-5">
        {effective.map((id) => (
          <div
            key={id}
            draggable={editing}
            onDragStart={(e) => { dragId.current = id; e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => {
              if (!editing) return;
              e.preventDefault();
              const over = dragId.current === id ? null : id;
              if (overId !== over) setOverId(over);
            }}
            onDrop={(e) => { if (!editing) return; e.preventDefault(); handleDrop(id); }}
            onDragEnd={() => { dragId.current = null; setOverId(null); }}
            className={`relative ${editing ? "cursor-grab" : ""} ${overId === id ? "rounded-xl ring-2 ring-brand/50" : ""}`}
          >
            {editing && (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl border-2 border-dashed border-brand/40 bg-brand/5">
                <span className="flex items-center gap-1.5 text-sm font-medium text-brand">
                  <GripVertical size={16} /> Drag to reorder
                </span>
              </div>
            )}
            <div className={editing ? "pointer-events-none select-none opacity-80" : ""}>
              {byId.get(id)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
