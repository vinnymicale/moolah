import { describe, it, expect } from "vitest";
import { findTransferPairs, type MatchableTxn } from "./transfer-match";

const CC = "acct-cc";
const CHECKING = "acct-checking";
const isCC = (id: string) => id === CC;

let n = 0;
function t(over: Partial<MatchableTxn>): MatchableTxn {
  return {
    id: `t${++n}`,
    type: "EXPENSE",
    amountCents: 50000,
    dateISO: "2026-06-01",
    accountId: CHECKING,
    isTransfer: false,
    transferPeerId: null,
    ...over,
  };
}

describe("findTransferPairs", () => {
  it("pairs a CC credit with the matching bank expense", () => {
    const expense = t({ type: "EXPENSE", accountId: CHECKING, dateISO: "2026-06-01" });
    const credit = t({ type: "INCOME", accountId: CC, dateISO: "2026-06-03" });
    expect(findTransferPairs([expense, credit], isCC)).toEqual([
      { expenseId: expense.id, incomeId: credit.id },
    ]);
  });

  it("requires exact amount match", () => {
    const expense = t({ amountCents: 50000 });
    const credit = t({ type: "INCOME", accountId: CC, amountCents: 50001 });
    expect(findTransferPairs([expense, credit], isCC)).toEqual([]);
  });

  it("respects the date window", () => {
    const expense = t({ dateISO: "2026-06-01" });
    const credit = t({ type: "INCOME", accountId: CC, dateISO: "2026-06-09" });
    expect(findTransferPairs([expense, credit], isCC)).toEqual([]);
    expect(findTransferPairs([expense, credit], isCC, 10)).toHaveLength(1);
  });

  it("prefers the closest-dated expense when several match", () => {
    const far = t({ dateISO: "2026-06-01" });
    const near = t({ dateISO: "2026-06-04" });
    const credit = t({ type: "INCOME", accountId: CC, dateISO: "2026-06-05" });
    expect(findTransferPairs([far, near, credit], isCC)).toEqual([
      { expenseId: near.id, incomeId: credit.id },
    ]);
  });

  it("never reuses an expense for two credits", () => {
    const expense = t({});
    const credit1 = t({ type: "INCOME", accountId: CC, dateISO: "2026-06-02" });
    const credit2 = t({ type: "INCOME", accountId: CC, dateISO: "2026-06-03" });
    const pairs = findTransferPairs([expense, credit1, credit2], isCC);
    expect(pairs).toHaveLength(1);
  });

  it("skips rows already paired and credits on non-CC accounts", () => {
    const expense = t({ isTransfer: true });
    const credit = t({ type: "INCOME", accountId: CC });
    expect(findTransferPairs([expense, credit], isCC)).toEqual([]);

    const bankIncome = t({ type: "INCOME", accountId: CHECKING });
    const expense2 = t({});
    expect(findTransferPairs([expense2, bankIncome], isCC)).toEqual([]);
  });

  it("ignores CC-account expenses as the funding side", () => {
    const ccExpense = t({ accountId: CC });
    const credit = t({ type: "INCOME", accountId: CC });
    expect(findTransferPairs([ccExpense, credit], isCC)).toEqual([]);
  });
});
