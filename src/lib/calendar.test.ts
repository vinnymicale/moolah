import { describe, it, expect } from "vitest";
import {
  occurrenceIsMatched,
  groupEventsByDay,
  eventIsActual,
  ccDueIsVisible,
  MATCH_WINDOW_MS,
  type CalendarEvent,
} from "./calendar";
import { parseISODay } from "./dates";

const day = (iso: string) => parseISODay(iso).getTime();

const event = (over: Partial<CalendarEvent>): CalendarEvent => ({
  id: "e",
  date: "2026-06-10",
  type: "EXPENSE",
  amount: 0,
  description: "x",
  note: null,
  categoryId: null,
  accountId: null,
  cleared: false,
  isVirtual: false,
  isTransfer: false,
  recurringRuleId: null,
  plaidTransactionId: null,
  ...over,
});

describe("occurrenceIsMatched", () => {
  const occ = parseISODay("2026-06-07");

  it("is false with no materialised dates", () => {
    expect(occurrenceIsMatched(occ, undefined)).toBe(false);
    expect(occurrenceIsMatched(occ, [])).toBe(false);
  });

  it("matches a real transaction within the proximity window", () => {
    expect(occurrenceIsMatched(occ, [day("2026-06-08")])).toBe(true); // 1 day late
    expect(occurrenceIsMatched(occ, [day("2026-06-11")])).toBe(true); // 4 days, at the edge
  });

  it("does not match outside the window", () => {
    expect(occurrenceIsMatched(occ, [day("2026-06-12")])).toBe(false); // 5 days
    expect(occurrenceIsMatched(occ, [day("2026-06-02")])).toBe(false); // 5 days early
  });

  it("uses a four-day window", () => {
    expect(MATCH_WINDOW_MS).toBe(4 * 86_400_000);
  });
});

describe("eventIsActual", () => {
  const today = "2026-06-10";

  it("is true for a cleared transaction on or before today", () => {
    expect(eventIsActual(event({ cleared: true, date: "2026-06-10" }), today)).toBe(true);
    expect(eventIsActual(event({ cleared: true, date: "2026-06-09" }), today)).toBe(true);
  });

  it("is false for pending, virtual, or future-dated events", () => {
    expect(eventIsActual(event({ cleared: false, date: "2026-06-09" }), today)).toBe(false);
    expect(eventIsActual(event({ cleared: true, isVirtual: true, date: "2026-06-09" }), today)).toBe(false);
    expect(eventIsActual(event({ cleared: true, date: "2026-06-11" }), today)).toBe(false);
  });
});

describe("groupEventsByDay", () => {
  const grid = new Set(["2026-06-09", "2026-06-10", "2026-06-11"]);
  const today = "2026-06-10";

  it("buckets events by day and drops days outside the grid", () => {
    const { eventsByDay } = groupEventsByDay(
      [event({ id: "a", date: "2026-06-10" }), event({ id: "b", date: "2026-05-30" })],
      grid,
      5, // June (0-indexed)
      today,
    );
    expect(Object.keys(eventsByDay)).toEqual(["2026-06-10"]);
    expect(eventsByDay["2026-06-10"].map((e) => e.id)).toEqual(["a"]);
  });

  it("sums real income and expense for the visible month, excluding transfers", () => {
    const { monthIncome, monthExpense } = groupEventsByDay(
      [
        event({ date: "2026-06-09", type: "INCOME", amount: 1000 }),
        event({ date: "2026-06-10", type: "EXPENSE", amount: 200 }),
        event({ date: "2026-06-10", type: "INCOME", amount: 500, isTransfer: true }), // CC payment credit
      ],
      grid,
      5,
      today,
    );
    expect(monthIncome).toBe(1000);
    expect(monthExpense).toBe(200);
  });

  it("splits actual (cleared, on/before today) from the projected grand total", () => {
    const { monthExpense, monthExpenseActual, monthIncome, monthIncomeActual } = groupEventsByDay(
      [
        event({ date: "2026-06-09", type: "EXPENSE", amount: 100, cleared: true }), // actual
        event({ date: "2026-06-10", type: "EXPENSE", amount: 50, cleared: false }), // pending → projected only
        event({ date: "2026-06-11", type: "EXPENSE", amount: 30, cleared: true, isVirtual: true }), // future recurring
        event({ date: "2026-06-09", type: "INCOME", amount: 1000, cleared: true }), // actual
        event({ date: "2026-06-11", type: "INCOME", amount: 200, cleared: true }), // future-dated → projected only
      ],
      grid,
      5,
      today,
    );
    expect(monthExpenseActual).toBe(100);
    expect(monthExpense).toBe(180);
    expect(monthIncomeActual).toBe(1000);
    expect(monthIncome).toBe(1200);
  });

  it("excludes grid days that belong to an adjacent month from the totals", () => {
    const sept = new Set(["2026-05-31", "2026-06-01"]);
    const { monthIncome } = groupEventsByDay(
      [event({ date: "2026-05-31", type: "INCOME", amount: 999 })],
      sept,
      5, // visible month is June, so the May 31 spillover day is excluded
      today,
    );
    expect(monthIncome).toBe(0);
  });

  it("orders each day income-first then by amount descending", () => {
    const { eventsByDay } = groupEventsByDay(
      [
        event({ id: "exp-small", date: "2026-06-10", type: "EXPENSE", amount: 10 }),
        event({ id: "exp-big", date: "2026-06-10", type: "EXPENSE", amount: 90 }),
        event({ id: "inc", date: "2026-06-10", type: "INCOME", amount: 5 }),
      ],
      grid,
      5,
      today,
    );
    expect(eventsByDay["2026-06-10"].map((e) => e.id)).toEqual(["inc", "exp-big", "exp-small"]);
  });
});

describe("ccDueIsVisible", () => {
  const today = "2026-06-10";

  it("shows future due dates", () => {
    expect(ccDueIsVisible("2026-06-15", null, today)).toBe(true);
  });

  it("shows today's due date", () => {
    expect(ccDueIsVisible("2026-06-10", null, today)).toBe(true);
  });

  it("hides past due dates that are not flagged overdue", () => {
    expect(ccDueIsVisible("2026-06-05", null, today)).toBe(false);
    expect(ccDueIsVisible("2026-06-05", false, today)).toBe(false);
  });

  it("shows past due dates that are explicitly overdue", () => {
    expect(ccDueIsVisible("2026-06-05", true, today)).toBe(true);
  });
});
