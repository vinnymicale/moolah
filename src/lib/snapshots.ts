// Net-worth history: daily balance snapshots and the carry-forward series the
// Net Worth page and read-only API chart.
//
// AccountSnapshot stores one balance row per account per day (the
// @@unique([accountId, date]) constraint keeps the daily capture idempotent).
// captureNetWorthSnapshot() is called after every Plaid sync so history accrues
// without any manual entry; getNetWorthHistory() reads it back, carrying the
// last known balance forward across days an account wasn't touched so the
// resulting net-worth line is continuous rather than full of gaps.

import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import { addUTCDays, isoDay, parseISODay } from "@/lib/dates";

/** One day on the net-worth line: totals derived from carried-forward balances. */
export interface NetWorthPoint {
  date: string; // ISO day
  assets: number;
  liabilities: number;
  net: number;
}

/**
 * Write today's balance for every (non-archived) account owned by the user,
 * upserting so a second sync on the same day overwrites rather than stacks.
 * `todayISO` lets callers pass the user's own calendar day; defaults to UTC.
 */
export async function captureNetWorthSnapshot(
  userId: string,
  todayISO: string = isoDay(new Date()),
): Promise<{ captured: number }> {
  const accounts = await prisma.financialAccount.findMany({
    where: { userId, archived: false },
    select: { id: true, currentBalance: true },
  });
  const date = parseISODay(todayISO);
  let captured = 0;
  for (const a of accounts) {
    await prisma.accountSnapshot.upsert({
      where: { accountId_date: { accountId: a.id, date } },
      create: { accountId: a.id, date, balance: a.currentBalance },
      update: { balance: a.currentBalance },
    });
    captured++;
  }
  return { captured };
}

/**
 * Build the net-worth line for a user over the last `days` calendar days.
 *
 * Snapshots are sparse (only days an account was synced/edited get a row), so
 * for each day we carry forward the most recent balance seen for each account
 * up to and including that day. An account contributes to assets or liabilities
 * by its current isAsset flag, and only if includeInNetWorth is set. Days
 * before an account's first snapshot simply omit it (it didn't exist yet).
 */
export async function getNetWorthHistory(
  userId: string,
  days: number,
  todayISO: string = isoDay(new Date()),
): Promise<NetWorthPoint[]> {
  const today = parseISODay(todayISO);
  const start = addUTCDays(today, -(days - 1));

  const accounts = await prisma.financialAccount.findMany({
    where: { userId, includeInNetWorth: true, archived: false },
    select: { id: true, isAsset: true },
  });
  if (accounts.length === 0) return [];
  const isAssetOf = new Map(accounts.map((a) => [a.id, a.isAsset]));
  const accountIds = accounts.map((a) => a.id);

  // All snapshots up to today, ascending, so the carry-forward walk is in order.
  const snaps = await prisma.accountSnapshot.findMany({
    where: { accountId: { in: accountIds }, date: { lte: today } },
    orderBy: { date: "asc" },
    select: { accountId: true, date: true, balance: true },
  });

  // Seed each account's running balance from the last snapshot strictly before
  // the window so day one already reflects pre-window history.
  const startISO = isoDay(start);
  const running = new Map<string, number>();
  // Snapshots that land on or after the window start, grouped by ISO day.
  const byDay = new Map<string, { accountId: string; balance: number }[]>();
  for (const s of snaps) {
    const dISO = isoDay(s.date);
    if (dISO < startISO) {
      running.set(s.accountId, toNumber(s.balance));
    } else {
      if (!byDay.has(dISO)) byDay.set(dISO, []);
      byDay.get(dISO)!.push({ accountId: s.accountId, balance: toNumber(s.balance) });
    }
  }

  const out: NetWorthPoint[] = [];
  for (let i = 0; i < days; i++) {
    const dISO = isoDay(addUTCDays(start, i));
    for (const { accountId, balance } of byDay.get(dISO) ?? []) {
      running.set(accountId, balance);
    }
    let assets = 0;
    let liabilities = 0;
    for (const [accountId, balance] of running) {
      if (isAssetOf.get(accountId)) assets += balance;
      else liabilities += balance;
    }
    out.push({ date: dISO, assets, liabilities, net: assets - liabilities });
  }
  return out;
}
