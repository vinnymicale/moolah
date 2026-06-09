import { describe, it, expect } from "vitest";
import {
  parseBankCsv,
  parseAmountCell,
  parseDateCell,
  guessCategoryName,
  splitCsv,
} from "./csv-import";

const DISCOVER = `Transaction Date,Transaction Description,Transaction Type,Debit,Credit
5/31/2026,CUMBERLAND -U5 TIVERTON RI ATM Fee,Debit,$3.50 ,0
5/28/2026,Early Pay PAYROLL ACH from ANALEX CORP,Credit,0,"$3,085.92 "
5/26/2026,SPOTIFY P42DA18,Debit,$13.90 ,0
5/5/2026,Check 175,Debit,"$2,500.00 ",0`;

describe("splitCsv", () => {
  it("respects quoted fields containing commas", () => {
    const grid = splitCsv(`a,b,c\n1,"2,200.00",3`);
    expect(grid[1]).toEqual(["1", "2,200.00", "3"]);
  });

  it("drops blank lines", () => {
    const grid = splitCsv("a,b\n\n1,2\n");
    expect(grid).toHaveLength(2);
  });
});

describe("parseAmountCell", () => {
  it("strips $, commas and whitespace", () => {
    expect(parseAmountCell("$3,085.92 ")).toBe(3085.92);
  });
  it("treats 0 and blanks as null", () => {
    expect(parseAmountCell("0")).toBeNull();
    expect(parseAmountCell(" ")).toBeNull();
    expect(parseAmountCell(undefined)).toBeNull();
  });
  it("handles negatives and accounting parens", () => {
    expect(parseAmountCell("-12.50")).toBe(-12.5);
    expect(parseAmountCell("(45.00)")).toBe(-45);
  });
});

describe("parseDateCell", () => {
  it("parses US M/D/YYYY", () => {
    expect(parseDateCell("5/31/2026")).toBe("2026-05-31");
    expect(parseDateCell("3/4/2026")).toBe("2026-03-04");
  });
  it("parses ISO", () => {
    expect(parseDateCell("2026-05-31")).toBe("2026-05-31");
  });
  it("expands two-digit years", () => {
    expect(parseDateCell("1/2/26")).toBe("2026-01-02");
  });
  it("rejects garbage and impossible dates", () => {
    expect(parseDateCell("not a date")).toBeNull();
    expect(parseDateCell("2/30/2026")).toBeNull();
  });
});

describe("parseBankCsv - Discover debit/credit format", () => {
  const result = parseBankCsv(DISCOVER);

  it("detects the debit/credit format", () => {
    expect(result.format).toMatch(/debit/i);
  });

  it("classifies debits as expenses and credits as income", () => {
    expect(result.rows).toEqual([
      { date: "2026-05-31", description: "CUMBERLAND -U5 TIVERTON RI ATM Fee", amount: 3.5, type: "EXPENSE" },
      { date: "2026-05-28", description: "Early Pay PAYROLL ACH from ANALEX CORP", amount: 3085.92, type: "INCOME" },
      { date: "2026-05-26", description: "SPOTIFY P42DA18", amount: 13.9, type: "EXPENSE" },
      { date: "2026-05-05", description: "Check 175", amount: 2500, type: "EXPENSE" },
    ]);
  });
});

describe("parseBankCsv - single signed amount format", () => {
  const csv = `Date,Description,Amount
2026-01-10,Coffee Shop,-4.50
2026-01-11,Paycheck,1500.00`;
  const result = parseBankCsv(csv);

  it("uses the sign to determine direction", () => {
    expect(result.rows).toEqual([
      { date: "2026-01-10", description: "Coffee Shop", amount: 4.5, type: "EXPENSE" },
      { date: "2026-01-11", description: "Paycheck", amount: 1500, type: "INCOME" },
    ]);
  });
});

describe("parseBankCsv - error handling", () => {
  it("skips rows with bad dates or no amount", () => {
    const csv = `Transaction Date,Transaction Description,Debit,Credit
not-a-date,Bad row,$5.00 ,0
5/1/2026,Empty amounts,0,0`;
    const result = parseBankCsv(csv);
    expect(result.rows).toHaveLength(0);
    expect(result.skipped).toHaveLength(2);
  });

  it("reports an unrecognised header", () => {
    const result = parseBankCsv("foo,bar\n1,2");
    expect(result.format).toBe("Unrecognised");
    expect(result.rows).toHaveLength(0);
  });
});

describe("guessCategoryName", () => {
  it("maps known merchants to default categories", () => {
    expect(guessCategoryName("SPOTIFY P42DA18", "EXPENSE")).toBe("Subscriptions");
    expect(guessCategoryName("ACH Withdrawal PROG DIRECT INS INS PREM", "EXPENSE")).toBe("Insurance");
    expect(guessCategoryName("Early Pay PAYROLL ACH from ANALEX CORP", "INCOME")).toBe("Salary");
    expect(guessCategoryName("Early Pay RIREFUND ACH from RI TAX DIVISION", "INCOME")).toBe("Refund");
  });
  it("returns null when nothing matches", () => {
    expect(guessCategoryName("ACH Withdrawal VENMO PAYMENT", "EXPENSE")).toBeNull();
  });
});
