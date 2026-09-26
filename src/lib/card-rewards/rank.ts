import { REWARD_CATEGORIES, type RewardCategoryKey } from "./categories";
import { ROTATING_CAP_KEY, type CapPeriod, type RewardCurrency, type RewardRule, type RotatingProgram } from "./types";

export const EVERYTHING_ELSE = "EVERYTHING_ELSE";
export type RankCategory = RewardCategoryKey | typeof EVERYTHING_ELSE;
export type RankMode = "effective" | "raw";

export interface RankInputProfile {
  profileId: string;
  accountId: string;
  name: string;
  color: string;
  currency: RewardCurrency;
  centsPerPoint: number;
  baseRate: number;
  rules: RewardRule[];
  rotating: RotatingProgram | null;
}

export interface CapProgressDTO {
  profileId: string;
  capKey: string;
  periodStart: string;
  spent: number;
  activated: boolean;
}

export interface RankEntry {
  accountId: string;
  name: string;
  color: string;
  rate: number;
  effectivePct: number;
  source: "rule" | "rotating" | "base";
}

export interface CategoryRanking {
  category: RankCategory;
  winner: RankEntry | null;
  runnerUp: RankEntry | null;
  cappedOut: string[];
  activateHint: RankEntry | null;
}

export function currentQuarter(date: Date): { year: number; quarter: 1 | 2 | 3 | 4 } {
  return {
    year: date.getUTCFullYear(),
    quarter: (Math.floor(date.getUTCMonth() / 3) + 1) as 1 | 2 | 3 | 4,
  };
}

export function periodStart(period: CapPeriod, date: Date): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  if (period === "YEAR") return new Date(Date.UTC(year, 0, 1));
  if (period === "QUARTER") return new Date(Date.UTC(year, month - (month % 3), 1));
  return new Date(Date.UTC(year, month, 1));
}

export function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function findProgress(
  progress: CapProgressDTO[],
  profileId: string,
  capKey: string,
  period: CapPeriod,
  today: Date,
): CapProgressDTO | undefined {
  const start = isoDay(periodStart(period, today));
  return progress.find((p) => p.profileId === profileId && p.capKey === capKey && p.periodStart === start);
}

export function effectiveMultiplier(p: Pick<RankInputProfile, "currency" | "centsPerPoint">): number {
  return p.currency === "CASH" ? 1 : p.centsPerPoint;
}

export function rotatingCategoriesFor(rotating: RotatingProgram | null, date: Date): RewardCategoryKey[] {
  if (!rotating) return [];
  const { year, quarter } = currentQuarter(date);
  return rotating.quarters.find((q) => q.year === year && q.quarter === quarter)?.categories ?? [];
}

interface CardOutcome {
  entry: RankEntry;
  cappedRate: number | null;
  inactiveRotating: RankEntry | null;
}

function entryFor(p: RankInputProfile, rate: number, source: RankEntry["source"]): RankEntry {
  return {
    accountId: p.accountId,
    name: p.name,
    color: p.color,
    rate,
    effectivePct: round(rate * effectiveMultiplier(p)),
    source,
  };
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}

function outcomeFor(p: RankInputProfile, category: RankCategory, progress: CapProgressDTO[], today: Date): CardOutcome {
  let best = entryFor(p, p.baseRate, "base");
  let cappedRate: number | null = null;
  let inactiveRotating: RankEntry | null = null;
  if (category === EVERYTHING_ELSE) return { entry: best, cappedRate, inactiveRotating };

  const rule = p.rules.find((r) => r.category === category);
  if (rule) {
    const used = rule.cap ? findProgress(progress, p.profileId, category, rule.cap.period, today) : undefined;
    if (rule.cap && used && used.spent >= rule.cap.amount) cappedRate = rule.rate;
    else if (rule.rate > best.rate) best = entryFor(p, rule.rate, "rule");
  }

  if (p.rotating && rotatingCategoriesFor(p.rotating, today).includes(category)) {
    const row = findProgress(progress, p.profileId, ROTATING_CAP_KEY, "QUARTER", today);
    if (!row?.activated) inactiveRotating = entryFor(p, p.rotating.rate, "rotating");
    else if (row.spent >= p.rotating.capAmount) cappedRate = Math.max(cappedRate ?? 0, p.rotating.rate);
    else if (p.rotating.rate > best.rate) best = entryFor(p, p.rotating.rate, "rotating");
  }

  return { entry: best, cappedRate, inactiveRotating };
}

export function rankCards(
  profiles: RankInputProfile[],
  progress: CapProgressDTO[],
  today: Date,
  mode: RankMode,
): CategoryRanking[] {
  const score = (e: RankEntry) => (mode === "raw" ? e.rate : e.effectivePct);
  const compare = (a: RankEntry, b: RankEntry) =>
    score(b) - score(a) || b.effectivePct - a.effectivePct || a.name.localeCompare(b.name);

  const categories: RankCategory[] = [...REWARD_CATEGORIES.map((c) => c.key), EVERYTHING_ELSE];
  return categories.map((category) => {
    const outcomes = profiles.map((p) => outcomeFor(p, category, progress, today));
    const sorted = outcomes.map((o) => o.entry).sort(compare);
    const winner = sorted[0] ?? null;

    const cappedOut = outcomes
      .filter((o) => o.cappedRate !== null && o.cappedRate > o.entry.rate)
      .map((o) => o.entry.name)
      .sort();

    const activateHint =
      outcomes
        .map((o) => o.inactiveRotating)
        .filter((e): e is RankEntry => e !== null && (!winner || compare(e, winner) < 0))
        .sort(compare)[0] ?? null;

    return { category, winner, runnerUp: sorted[1] ?? null, cappedOut, activateHint };
  });
}
