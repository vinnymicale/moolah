import { describe, expect, it } from "vitest";
import type { TransactionDTO } from "@/lib/queries";
import {
  PAGE_SIZE, filterTransactionDTOs, paginateTransactionDTOs, parseTransactionFilters,
} from "./transactions-utils";
import { resolveTransactionsRange } from "./resolve-range";

function txn(overrides: Partial<TransactionDTO>): TransactionDTO {
  return {
    id: "t1",
    type: "EXPENSE",
    amount: 10,
    date: "2026-06-15",
    description: "Coffee",
    note: null,
    accountId: null,
    categoryId: null,
    cleared: true,
    isTransfer: false,
    effectiveTransfer: false,
    recurringRuleId: null,
    plaidTransactionId: null,
    splits: [],
    ...overrides,
  };
}

describe("parseTransactionFilters", () => {
  it("parses and validates all filter params", () => {
    const f = parseTransactionFilters({
      q: "  uber ",
      type: "EXPENSE,BOGUS",
      status: "PENDING",
      category: "c1,__uncategorized__",
      account: "a1",
    });
    expect(f.search).toBe("uber");
    expect(f.types).toEqual(["EXPENSE"]);
    expect(f.statuses).toEqual(["PENDING"]);
    expect(f.categoryIds).toEqual(["c1", "__uncategorized__"]);
    expect(f.accountIds).toEqual(["a1"]);
  });

  it("returns empty filters for missing params", () => {
    const f = parseTransactionFilters({});
    expect(f).toEqual({ search: "", types: [], statuses: [], categoryIds: [], accountIds: [] });
  });
});

describe("filterTransactionDTOs", () => {
  const cats = new Map([["c1", "Groceries"]]);
  const list = [
    txn({ id: "a", description: "Trader Joes", categoryId: "c1", cleared: true }),
    txn({ id: "b", description: "Paycheck", type: "INCOME", cleared: false }),
    txn({ id: "c", description: "Rent", accountId: "acct1", note: "june rent" }),
  ];

  it("matches search against description, note and category name, case-insensitively", () => {
    const base = parseTransactionFilters({});
    expect(filterTransactionDTOs(list, { ...base, search: "GROCER" }, cats).map((t) => t.id)).toEqual(["a"]);
    expect(filterTransactionDTOs(list, { ...base, search: "june" }, cats).map((t) => t.id)).toEqual(["c"]);
    expect(filterTransactionDTOs(list, { ...base, search: "pay" }, cats).map((t) => t.id)).toEqual(["b"]);
  });

  it("filters by type, status, and sentinel ids", () => {
    const base = parseTransactionFilters({});
    expect(filterTransactionDTOs(list, { ...base, types: ["INCOME"] }, cats).map((t) => t.id)).toEqual(["b"]);
    expect(filterTransactionDTOs(list, { ...base, statuses: ["PENDING"] }, cats).map((t) => t.id)).toEqual(["b"]);
    expect(filterTransactionDTOs(list, { ...base, categoryIds: ["__uncategorized__"] }, cats).map((t) => t.id)).toEqual(["b", "c"]);
    expect(filterTransactionDTOs(list, { ...base, accountIds: ["__none__"] }, cats).map((t) => t.id)).toEqual(["a", "b"]);
    expect(filterTransactionDTOs(list, { ...base, accountIds: ["acct1"] }, cats).map((t) => t.id)).toEqual(["c"]);
  });

  it("treats both statuses selected as no constraint", () => {
    const base = parseTransactionFilters({});
    expect(filterTransactionDTOs(list, { ...base, statuses: ["CLEARED", "PENDING"] }, cats)).toHaveLength(3);
  });
});

describe("paginateTransactionDTOs", () => {
  it("pages results and clamps out-of-range pages", () => {
    const list = Array.from({ length: PAGE_SIZE + 5 }, (_, i) => txn({ id: `t${i}` }));
    const p1 = paginateTransactionDTOs(list, 1);
    expect(p1.items).toHaveLength(PAGE_SIZE);
    expect(p1.pageCount).toBe(2);
    expect(p1.total).toBe(PAGE_SIZE + 5);
    const p9 = paginateTransactionDTOs(list, 9);
    expect(p9.page).toBe(2);
    expect(p9.items).toHaveLength(5);
    expect(paginateTransactionDTOs([], 1).pageCount).toBe(1);
  });

  it("excludes effective transfers from income/expense totals", () => {
    const list = [
      txn({ id: "a", type: "INCOME", amount: 100 }),
      txn({ id: "b", type: "INCOME", amount: 40, effectiveTransfer: true }),
      txn({ id: "c", type: "EXPENSE", amount: 25 }),
      txn({ id: "d", type: "EXPENSE", amount: 5, isTransfer: true, effectiveTransfer: true }),
    ];
    const page = paginateTransactionDTOs(list, 1);
    expect(page.income).toBe(100);
    expect(page.expense).toBe(25);
  });
});

describe("resolveTransactionsRange", () => {
  const today = "2026-07-03";

  it("defaults to the current month", () => {
    const r = resolveTransactionsRange({}, today);
    expect(r).toMatchObject({ range: "month", startISO: "2026-07-01", endISO: "2026-07-31", slug: "2026-07" });
  });

  it("respects an explicit month param", () => {
    const r = resolveTransactionsRange({ m: "2026-02" }, today);
    expect(r).toMatchObject({ startISO: "2026-02-01", endISO: "2026-02-28", slug: "2026-02" });
  });

  it("resolves relative ranges from today", () => {
    expect(resolveTransactionsRange({ range: "3m" }, today)).toMatchObject({ startISO: "2026-05-01", endISO: "2026-07-31", slug: "3m" });
    expect(resolveTransactionsRange({ range: "ytd" }, today)).toMatchObject({ startISO: "2026-01-01", slug: "ytd" });
    expect(resolveTransactionsRange({ range: "all" }, today)).toMatchObject({ startISO: "1970-01-01", endISO: "2999-12-31" });
  });

  it("forces custom mode when a valid from/to pair is present", () => {
    const r = resolveTransactionsRange({ from: "2026-01-05", to: "2026-01-20" }, today);
    expect(r).toMatchObject({ range: "custom", startISO: "2026-01-05", endISO: "2026-01-20", slug: "2026-01-05-to-2026-01-20" });
  });

  it("falls back to month when custom dates are invalid or reversed", () => {
    expect(resolveTransactionsRange({ range: "custom", from: "2026-01-20", to: "2026-01-05" }, today).range).toBe("month");
    expect(resolveTransactionsRange({ range: "custom", from: "not-a-date", to: "2026-01-05" }, today).range).toBe("month");
    expect(resolveTransactionsRange({ range: "custom" }, today).range).toBe("month");
  });
});
