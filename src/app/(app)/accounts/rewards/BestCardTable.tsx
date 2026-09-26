"use client";

import { useMemo, useSyncExternalStore } from "react";
import { Dot } from "@/components/ui-bits";
import { categoryLabel } from "@/lib/card-rewards/categories";
import {
  currentQuarter,
  rankCards,
  type CapProgressDTO,
  type RankEntry,
  type RankInputProfile,
  type RankMode,
} from "@/lib/card-rewards/rank";
import { CATEGORY_ICONS } from "./category-icons";
import { formatScore } from "./format";

const MODE_KEY = "moolah.rewards.mode";
const listeners = new Set<() => void>();
let fallbackMode: RankMode = "effective";

function readMode(): RankMode {
  try {
    return localStorage.getItem(MODE_KEY) === "raw" ? "raw" : "effective";
  } catch {
    return fallbackMode;
  }
}

function writeMode(next: RankMode) {
  fallbackMode = next;
  try {
    localStorage.setItem(MODE_KEY, next);
  } catch {}
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function BestCardTable({
  profiles,
  progress,
  today,
}: {
  profiles: RankInputProfile[];
  progress: CapProgressDTO[];
  today: string;
}) {
  const mode = useSyncExternalStore(subscribe, readMode, () => "effective" as const);


  const date = useMemo(() => new Date(today), [today]);
  const rankings = useMemo(() => rankCards(profiles, progress, date, mode), [profiles, progress, date, mode]);
  const { quarter } = currentQuarter(date);
  const currencyOf = (e: RankEntry) => profiles.find((p) => p.accountId === e.accountId)?.currency ?? "CASH";

  return (
    <section className="card mb-6 p-4 md:p-5">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-display text-lg font-semibold">Best card by category</h2>
          <p className="text-sm text-muted">
            {mode === "effective"
              ? "Ranked by cash value, with points converted at each card's cents per point."
              : "Ranked by the multiplier printed on the card."}
          </p>
        </div>
        <div className="inline-flex rounded-full border border-line bg-surface p-1 text-sm" role="group">
          {(["effective", "raw"] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              onClick={() => writeMode(m)}
              className={`rounded-full px-3 py-1 font-medium transition-colors ${
                mode === m ? "bg-surface2 text-text" : "text-muted hover:text-text"
              }`}
            >
              {m === "effective" ? "Effective" : "Raw"}
            </button>
          ))}
        </div>
      </div>

      <div className="hidden grid-cols-[1fr_1.5fr_1fr] gap-3 border-b border-line pb-2 text-xs font-medium uppercase tracking-wide text-muted sm:grid">
        <span>Category</span>
        <span>Best card</span>
        <span>Runner-up</span>
      </div>
      <ul className="divide-y divide-line">
        {rankings.map((r) => {
          const Icon = CATEGORY_ICONS[r.category];
          return (
            <li key={r.category} className="grid gap-1.5 py-3 sm:grid-cols-[1fr_1.5fr_1fr] sm:items-start sm:gap-3">
              <span className="flex items-center gap-2 font-medium">
                <Icon size={16} className="text-muted" aria-hidden />
                {categoryLabel(r.category)}
              </span>
              <div>
                {r.winner ? (
                  <span className="flex flex-wrap items-center gap-2">
                    <Dot color={r.winner.color} />
                    <span className="font-medium">{r.winner.name}</span>
                    <span className="chip">{formatScore(r.winner, mode, currencyOf(r.winner))}</span>
                    {r.winner.source === "rotating" && (
                      <span className="text-xs text-muted">Q{quarter} · rotating</span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted">-</span>
                )}
                {r.activateHint && (
                  <p className="mt-1 text-xs text-muted">
                    Activate {r.activateHint.name} for{" "}
                    {formatScore(r.activateHint, mode, currencyOf(r.activateHint))}
                  </p>
                )}
                {r.cappedOut.length > 0 && (
                  <p className="mt-1 text-xs text-muted">{r.cappedOut.join(", ")} hit the cap this period</p>
                )}
              </div>
              <div className="text-sm text-muted">
                {r.runnerUp ? (
                  <span className="flex items-center gap-2">
                    <span className="sm:hidden">Runner-up:</span>
                    <Dot color={r.runnerUp.color} size={8} />
                    {r.runnerUp.name} · {formatScore(r.runnerUp, mode, currencyOf(r.runnerUp))}
                  </span>
                ) : (
                  <span className="hidden sm:inline">-</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
