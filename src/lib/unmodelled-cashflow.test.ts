// Tests for the unmodelled cash-flow rate: the part of a user's real income
// and spending that the recurring rules do not already project.

import { describe, it, expect } from "vitest";
import { unmodelledMonthlyRate, type CashflowTxn } from "./unmodelled-cashflow";

const txn = (o: Partial<CashflowTxn> & Pick<CashflowTxn, "date" | "type" | "amount">): CashflowTxn => ({
  recurringRuleId: null,
  isTransfer: false,
  accountType: null,
  ...o,
});

describe("unmodelledMonthlyRate", () => {
  it("returns null when the window has too little history", () => {
    const txns = [txn({ date: "2026-07-01", type: "EXPENSE", amount: 50 })];
    expect(unmodelledMonthlyRate(txns, "2026-06-20", "2026-07-30")).toBeNull();
  });

  it("averages unmodelled spending into a negative monthly rate", () => {
    // $300/month of groceries across 3 months, none of it rule-linked.
    const txns = [
      txn({ date: "2026-05-05", type: "EXPENSE", amount: 300 }),
      txn({ date: "2026-06-05", type: "EXPENSE", amount: 300 }),
      txn({ date: "2026-07-05", type: "EXPENSE", amount: 300 }),
    ];
    const rate = unmodelledMonthlyRate(txns, "2026-05-01", "2026-08-01");
    expect(rate).toBeCloseTo(-297.8, 0);
  });

  it("nets unmodelled income against unmodelled spending", () => {
    const txns = [
      txn({ date: "2026-05-10", type: "INCOME", amount: 900 }),
      txn({ date: "2026-06-10", type: "EXPENSE", amount: 300 }),
      txn({ date: "2026-07-10", type: "EXPENSE", amount: 300 }),
    ];
    // +900 - 600 = +300 across ~3.02 months.
    const rate = unmodelledMonthlyRate(txns, "2026-05-01", "2026-08-01");
    expect(rate).toBeCloseTo(99.5, 0);
  });

  it("excludes transactions the rules already project", () => {
    // The paycheck and rent are rule-linked, so the rules already count them;
    // only the unlinked grocery run is residual.
    const txns = [
      txn({ date: "2026-05-01", type: "INCOME", amount: 6000, recurringRuleId: "r1" }),
      txn({ date: "2026-06-01", type: "INCOME", amount: 6000, recurringRuleId: "r1" }),
      txn({ date: "2026-07-01", type: "INCOME", amount: 6000, recurringRuleId: "r1" }),
      txn({ date: "2026-05-05", type: "EXPENSE", amount: 2000, recurringRuleId: "r2" }),
      txn({ date: "2026-06-05", type: "EXPENSE", amount: 2000, recurringRuleId: "r2" }),
      txn({ date: "2026-06-15", type: "EXPENSE", amount: 300 }),
    ];
    const rate = unmodelledMonthlyRate(txns, "2026-05-01", "2026-08-01");
    expect(rate).toBeCloseTo(-99.5, 0);
  });

  it("excludes transfers, which move money without changing net worth", () => {
    const txns = [
      txn({ date: "2026-05-10", type: "EXPENSE", amount: 1500, isTransfer: true }),
      txn({ date: "2026-06-10", type: "EXPENSE", amount: 300 }),
      txn({ date: "2026-07-10", type: "EXPENSE", amount: 300 }),
    ];
    const rate = unmodelledMonthlyRate(txns, "2026-05-01", "2026-08-01");
    expect(rate).toBeCloseTo(-198.9, 0);
  });

  it("excludes credit-card payment credits, which are effective transfers", () => {
    // A payment landing on the card reads as INCOME on a CREDIT_CARD account;
    // counting it would book the same money as income twice.
    const txns = [
      txn({ date: "2026-05-10", type: "INCOME", amount: 1500, accountType: "CREDIT_CARD" }),
      txn({ date: "2026-06-10", type: "EXPENSE", amount: 300 }),
      txn({ date: "2026-07-10", type: "EXPENSE", amount: 300 }),
    ];
    const rate = unmodelledMonthlyRate(txns, "2026-05-01", "2026-08-01");
    expect(rate).toBeCloseTo(-198.9, 0);
  });

  it("ignores transactions outside the window", () => {
    const txns = [
      txn({ date: "2026-01-01", type: "EXPENSE", amount: 9999 }),
      txn({ date: "2026-06-10", type: "EXPENSE", amount: 300 }),
      txn({ date: "2026-07-10", type: "EXPENSE", amount: 300 }),
    ];
    const rate = unmodelledMonthlyRate(txns, "2026-05-01", "2026-08-01");
    expect(rate).toBeCloseTo(-198.9, 0);
  });

  it("returns zero when every transaction is already modelled", () => {
    const txns = [
      txn({ date: "2026-05-01", type: "INCOME", amount: 6000, recurringRuleId: "r1" }),
      txn({ date: "2026-06-01", type: "INCOME", amount: 6000, recurringRuleId: "r1" }),
    ];
    expect(unmodelledMonthlyRate(txns, "2026-05-01", "2026-08-01")).toBe(0);
  });
});
