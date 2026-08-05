import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import { addUTCMonths, endOfUTCMonth, parseISODay } from "@/lib/dates";
import { sumPartsByCategory } from "@/lib/splits";
import { rowToSplittable } from "./shared";

// ── Spending anomalies ────────────────────────────────────────────────────────

export interface SpendingAnomalyDTO {
  categoryId: string;
  name: string;
  color: string;
  icon: string;
  /** Cleared expense spend for the current month. */
  thisMonth: number;
  /** Average cleared expense spend for the prior 3 months. */
  avg3Month: number;
  overBy: number;
  overPct: number;
}

/**
 * Returns categories where this month's cleared spending is ≥40% above the
 * 3-month average AND at least $30 more in absolute terms.  Returns [] when
 * there are fewer than 2 prior months of data for a category.
 */
export async function getSpendingAnomalies(
  userId: string,
  monthISO: string,
): Promise<SpendingAnomalyDTO[]> {
  const monthStart = parseISODay(`${monthISO.slice(0, 7)}-01`);
  const monthEnd = endOfUTCMonth(monthStart);

  // We can't pre-filter by categoryId in SQL: split transactions carry their
  // category attribution on child rows (the parent's categoryId is null), so the
  // per-category bucketing has to happen in JS after expanding each row's parts.
  const currentTxns = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      type: "EXPENSE",
      cleared: true,
      isTransfer: false,
      date: { gte: monthStart, lte: monthEnd },
    },
    select: { categoryId: true, amount: true, splits: { select: { categoryId: true, amount: true } } },
  });

  const currentByCat = sumPartsByCategory(currentTxns.map(rowToSplittable));
  if (currentByCat.size === 0) return [];

  // Three prior months, one query each (keeps this readable; only 3 trips).
  const historicalByCat = new Map<string, number[]>();
  for (let i = 1; i <= 3; i++) {
    const ms = addUTCMonths(monthStart, -i);
    const me = endOfUTCMonth(ms);
    const hist = await prisma.transaction.findMany({
      where: {
        userId,
        deletedAt: null,
        type: "EXPENSE",
        cleared: true,
        isTransfer: false,
        date: { gte: ms, lte: me },
      },
      select: { categoryId: true, amount: true, splits: { select: { categoryId: true, amount: true } } },
    });
    const monthByCat = sumPartsByCategory(hist.map(rowToSplittable));
    for (const catId of currentByCat.keys()) {
      const arr = historicalByCat.get(catId) ?? [];
      arr.push(monthByCat.get(catId) ?? 0);
      historicalByCat.set(catId, arr);
    }
  }

  const cats = await prisma.category.findMany({
    where: { id: { in: [...currentByCat.keys()] }, userId },
    select: { id: true, name: true, color: true, icon: true },
  });
  const catMap = new Map(cats.map((c) => [c.id, c]));

  const anomalies: SpendingAnomalyDTO[] = [];
  for (const [catId, thisMonth] of currentByCat) {
    const history = historicalByCat.get(catId) ?? [];
    const nonZeroCount = history.filter((h) => h > 0).length;
    if (nonZeroCount < 2) continue; // need at least 2 real data points
    const avg3Month = history.reduce((s, h) => s + h, 0) / 3;
    if (avg3Month === 0) continue;
    const overBy = thisMonth - avg3Month;
    const overPct = (overBy / avg3Month) * 100;
    if (overPct < 40 || overBy < 30) continue;
    const cat = catMap.get(catId);
    if (!cat) continue;
    anomalies.push({
      categoryId: catId,
      name: cat.name,
      color: cat.color,
      icon: cat.icon,
      thisMonth: Math.round(thisMonth * 100) / 100,
      avg3Month: Math.round(avg3Month * 100) / 100,
      overBy: Math.round(overBy * 100) / 100,
      overPct: Math.round(overPct),
    });
  }

  return anomalies.sort((a, b) => b.overBy - a.overBy);
}

// ── Top merchants ─────────────────────────────────────────────────────────────

export interface TopMerchantDTO {
  description: string;
  amount: number;
  count: number;
  categoryId: string | null;
}

/**
 * Returns the top `limit` payees by total cleared expense spending this month.
 * Descriptions are matched case-insensitively; the first-seen capitalisation
 * is used for display.
 */
export async function getTopMerchants(
  userId: string,
  monthISO: string,
  limit = 6,
): Promise<TopMerchantDTO[]> {
  const monthStart = parseISODay(`${monthISO.slice(0, 7)}-01`);
  const monthEnd = endOfUTCMonth(monthStart);

  const txns = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      type: "EXPENSE",
      cleared: true,
      isTransfer: false,
      date: { gte: monthStart, lte: monthEnd },
    },
    select: { description: true, amount: true, categoryId: true },
  });

  const map = new Map<string, { display: string; amount: number; count: number; categoryId: string | null }>();
  for (const t of txns) {
    const key = t.description.trim().toLowerCase();
    const entry = map.get(key);
    if (entry) {
      entry.amount += toNumber(t.amount);
      entry.count++;
    } else {
      map.set(key, { display: t.description.trim(), amount: toNumber(t.amount), count: 1, categoryId: t.categoryId });
    }
  }

  return Array.from(map.values())
    .map((m) => ({ description: m.display, amount: Math.round(m.amount * 100) / 100, count: m.count, categoryId: m.categoryId }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, limit);
}
