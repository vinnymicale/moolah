import { describe, it, expect } from "vitest";
import { projectDailyBalances, lowestPoint, type ProjTxn } from "./projection";
import { isoDay } from "./dates";

const D = (s: string) => new Date(`${s}T00:00:00.000Z`);
const range = (start: string, n: number) =>
  Array.from({ length: n }, (_, i) => D(`2026-01-${String(Number(start.slice(-2)) + i).padStart(2, "0")}`));

describe("projectDailyBalances", () => {
  it("holds the anchor balance flat with no transactions", () => {
    const days = range("01", 5);
    const out = projectDailyBalances({ days, anchorDate: D("2026-01-01"), anchorBalance: 1000, txns: [] });
    expect(out.map((d) => d.balance)).toEqual([1000, 1000, 1000, 1000, 1000]);
  });

  it("projects future expenses forward from the anchor", () => {
    const days = range("01", 5);
    const txns: ProjTxn[] = [
      { date: D("2026-01-02"), amount: 100, type: "EXPENSE" },
      { date: D("2026-01-04"), amount: 50, type: "INCOME" },
    ];
    const out = projectDailyBalances({ days, anchorDate: D("2026-01-01"), anchorBalance: 1000, txns });
    // 01:1000, 02:900, 03:900, 04:950, 05:950
    expect(out.map((d) => d.balance)).toEqual([1000, 900, 900, 950, 950]);
  });

  it("reconstructs past days behind the anchor", () => {
    const days = range("01", 5);
    // Anchor is the 5th at $1000. A $200 income landed on the 3rd, so before it
    // the balance was $800.
    const txns: ProjTxn[] = [{ date: D("2026-01-03"), amount: 200, type: "INCOME" }];
    const out = projectDailyBalances({ days, anchorDate: D("2026-01-05"), anchorBalance: 1000, txns });
    // 01:800, 02:800, 03:1000, 04:1000, 05:1000
    expect(out.map((d) => d.balance)).toEqual([800, 800, 1000, 1000, 1000]);
  });

  it("includes anchor-day transactions in the end-of-day anchor balance", () => {
    const days = range("01", 3);
    const txns: ProjTxn[] = [{ date: D("2026-01-01"), amount: 100, type: "EXPENSE" }];
    const out = projectDailyBalances({ days, anchorDate: D("2026-01-01"), anchorBalance: 1000, txns });
    // The anchor already reflects the 100 expense; balance stays 1000 that day.
    expect(out[0].balance).toBe(1000);
  });

  it("aggregates per-day income, expense and net", () => {
    const days = range("01", 2);
    const txns: ProjTxn[] = [
      { date: D("2026-01-01"), amount: 100, type: "INCOME" },
      { date: D("2026-01-01"), amount: 30, type: "EXPENSE" },
      { date: D("2026-01-01"), amount: 20, type: "EXPENSE" },
    ];
    const out = projectDailyBalances({ days, anchorDate: D("2026-01-01"), anchorBalance: 0, txns });
    expect(out[0].income).toBe(100);
    expect(out[0].expense).toBe(50);
    expect(out[0].net).toBe(50);
  });

  it("avoids floating point drift on cents", () => {
    const days = range("01", 1);
    const txns: ProjTxn[] = [
      { date: D("2026-01-01"), amount: "0.10", type: "EXPENSE" },
      { date: D("2026-01-01"), amount: "0.20", type: "EXPENSE" },
    ];
    const out = projectDailyBalances({ days, anchorDate: D("2026-01-01"), anchorBalance: 1, txns });
    // 1 is anchor (end of day) so day balance is 1; check the net is exactly -0.30
    expect(out[0].net).toBe(-0.3);
  });

  it("lowestPoint finds the dip", () => {
    const days = range("01", 4);
    const txns: ProjTxn[] = [
      { date: D("2026-01-02"), amount: 800, type: "EXPENSE" },
      { date: D("2026-01-03"), amount: 500, type: "INCOME" },
    ];
    const out = projectDailyBalances({ days, anchorDate: D("2026-01-01"), anchorBalance: 1000, txns });
    const low = lowestPoint(out)!;
    expect(isoDay(low.day)).toBe("2026-01-02");
    expect(low.balance).toBe(200);
  });
});
