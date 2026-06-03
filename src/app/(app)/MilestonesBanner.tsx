"use client";

import { useEffect, useState } from "react";
import { PartyPopper, Trophy, Target, TrendingUp, X } from "lucide-react";
import type { Milestone } from "@/lib/milestones";

const DISMISS_KEY = "dismissedMilestones";

function loadDismissed(): Set<string> {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

const ICONS = {
  networth: Trophy,
  goal: Target,
  savings: TrendingUp,
} as const;

export function MilestonesBanner({ milestones }: { milestones: Milestone[] }) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setDismissed(loadDismissed());
    setHydrated(true);
  }, []);

  const dismiss = (id: string) => {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(id);
      try { localStorage.setItem(DISMISS_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  };

  // Avoid SSR mismatch — render nothing until localStorage is read.
  if (!hydrated) return null;

  const visible = milestones.filter((m) => !dismissed.has(m.id));
  if (visible.length === 0) return null;

  // Show one at a time to keep the dashboard calm.
  const m = visible[0];
  const Icon = ICONS[m.kind];

  return (
    <div className="mb-5 flex items-start gap-3 overflow-hidden rounded-xl border border-income/30 bg-gradient-to-br from-income/10 to-brand/10 px-4 py-3">
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-income/15 text-income">
        <Icon size={20} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 font-semibold text-text">
          <PartyPopper size={15} className="text-income" /> {m.title}
        </p>
        <p className="text-sm text-muted">{m.detail}</p>
      </div>
      <button onClick={() => dismiss(m.id)} className="btn-ghost h-7 w-7 shrink-0 !p-0 text-muted" title="Dismiss" aria-label="Dismiss">
        <X size={15} />
      </button>
    </div>
  );
}
