import { describe, it, expect } from "vitest";
import {
  plaidCategoryToName,
  tokens,
  descriptionMatches,
  matchRecurringRule,
  resolveCategoryId,
  plaidDay,
  parseLoanTerm,
  monthsBetweenDays,
  type MatchableRule,
} from "./plaid-sync";
import { parseISODay } from "./dates";

describe("plaidCategoryToName", () => {
  it("prefers the detailed category when mapped", () => {
    expect(plaidCategoryToName("FOOD_AND_DRINK", "FOOD_AND_DRINK_GROCERIES")).toBe("Groceries");
    expect(plaidCategoryToName("FOOD_AND_DRINK", "FOOD_AND_DRINK_RESTAURANT")).toBe("Dining Out");
  });

  it("falls back to the primary category when the detail is unmapped", () => {
    expect(plaidCategoryToName("FOOD_AND_DRINK", "FOOD_AND_DRINK_VENDING_MACHINES")).toBe("Dining Out");
    expect(plaidCategoryToName("ENTERTAINMENT", "")).toBe("Entertainment");
  });

  it("returns null when neither maps", () => {
    expect(plaidCategoryToName("UNKNOWN_THING", "ALSO_UNKNOWN")).toBeNull();
    expect(plaidCategoryToName("")).toBeNull();
  });
});

describe("tokens", () => {
  it("lowercases and keeps words of length >= 3", () => {
    expect([...tokens("SHELL OIL 42")]).toEqual(["shell", "oil"]);
  });

  it("drops noise words", () => {
    expect([...tokens("ACH PAYMENT FROM PAYROLL")]).toEqual(["payroll"]);
  });

  it("splits on non-alphanumerics", () => {
    expect([...tokens("Netflix.com*subscription")]).toEqual(["netflix", "com", "subscription"]);
  });
});

describe("descriptionMatches", () => {
  it("matches on a shared token", () => {
    expect(descriptionMatches("YOUTUBE PREMIUM", "YouTube")).toBe(true);
  });

  it("matches a >=5-char rule token as a substring of the transaction", () => {
    expect(descriptionMatches("SUNRUN PURCHASE", "Sunrun solar")).toBe(true);
  });

  it("does not match unrelated descriptions", () => {
    expect(descriptionMatches("SHELL OIL", "YouTube")).toBe(false);
  });

  it("ignores short coincidental fragments", () => {
    // "oil" (3 chars) is shared only by substring, which requires >=5 chars.
    expect(descriptionMatches("BOIL CO", "Toiletries")).toBe(false);
  });
});

const rule = (over: Partial<MatchableRule>): MatchableRule => ({
  id: "r1",
  type: "EXPENSE",
  amount: 100,
  description: "Netflix",
  frequency: "MONTHLY",
  interval: 1,
  startDate: parseISODay("2026-01-15"),
  endDate: null,
  dayOfMonth: 15,
  weekday: null,
  ...over,
});

describe("matchRecurringRule", () => {
  const date = parseISODay("2026-06-15");

  it("matches when amount, date window, and description all line up", () => {
    expect(matchRecurringRule([rule({})], "EXPENSE", date, 100, "NETFLIX.COM")).toBe("r1");
  });

  it("accepts amounts within 15% of the transaction amount", () => {
    // tolerance = txnAmount * 0.15; 110 -> 16.5 >= |100-110| = 10.
    expect(matchRecurringRule([rule({})], "EXPENSE", date, 110, "NETFLIX")).toBe("r1");
    expect(matchRecurringRule([rule({})], "EXPENSE", date, 90, "NETFLIX")).toBe("r1");
  });

  it("rejects amounts outside tolerance", () => {
    // 120 -> tolerance 18 < |100-120| = 20.
    expect(matchRecurringRule([rule({})], "EXPENSE", date, 120, "NETFLIX")).toBeNull();
  });

  it("rejects when the type differs", () => {
    expect(matchRecurringRule([rule({})], "INCOME", date, 100, "NETFLIX")).toBeNull();
  });

  it("requires a shared description token for expenses", () => {
    expect(matchRecurringRule([rule({})], "EXPENSE", date, 100, "SHELL OIL")).toBeNull();
  });

  it("skips the description check for income", () => {
    const paycheck = rule({ id: "pay", type: "INCOME", description: "Vinny's Paycheck" });
    expect(matchRecurringRule([paycheck], "INCOME", date, 100, "ACH DEPOSIT XYZ")).toBe("pay");
  });

  it("matches within the +/-2 day occurrence window but not outside it", () => {
    expect(matchRecurringRule([rule({})], "EXPENSE", parseISODay("2026-06-17"), 100, "NETFLIX")).toBe("r1");
    expect(matchRecurringRule([rule({})], "EXPENSE", parseISODay("2026-06-18"), 100, "NETFLIX")).toBeNull();
  });

  it("coerces a Decimal-like amount via Number()", () => {
    const decimalRule = rule({ amount: { toString: () => "100" } });
    expect(matchRecurringRule([decimalRule], "EXPENSE", date, 100, "NETFLIX")).toBe("r1");
  });

  it("returns the first matching rule", () => {
    const rules = [rule({ id: "a" }), rule({ id: "b" })];
    expect(matchRecurringRule(rules, "EXPENSE", date, 100, "NETFLIX")).toBe("a");
  });
});

describe("resolveCategoryId", () => {
  it("prefers the matched recurring rule's category over Plaid's", () => {
    expect(
      resolveCategoryId({ ruleCategoryId: null, recurringCategoryId: "rec", plaidCategoryId: "plaid" }),
    ).toBe("rec");
  });

  it("lets an explicit automation rule category win over the recurring rule", () => {
    expect(
      resolveCategoryId({ ruleCategoryId: "auto", recurringCategoryId: "rec", plaidCategoryId: "plaid" }),
    ).toBe("auto");
  });

  it("falls back to Plaid's category when the recurring rule has none", () => {
    expect(
      resolveCategoryId({ ruleCategoryId: null, recurringCategoryId: null, plaidCategoryId: "plaid" }),
    ).toBe("plaid");
  });

  it("returns null when nothing supplies a category", () => {
    expect(
      resolveCategoryId({ ruleCategoryId: null, recurringCategoryId: null, plaidCategoryId: null }),
    ).toBeNull();
  });
});

describe("plaidDay", () => {
  it("pins a bare Plaid date to UTC midnight", () => {
    expect(plaidDay("2026-03-01")?.toISOString()).toBe("2026-03-01T00:00:00.000Z");
  });

  it("returns null for a missing date", () => {
    expect(plaidDay(null)).toBeNull();
    expect(plaidDay(undefined)).toBeNull();
    expect(plaidDay("")).toBeNull();
  });
});

describe("parseLoanTerm", () => {
  it.each([
    ["30 year", 360],
    ["15-year fixed", 180],
    ["30 yr", 360],
    ["360 months", 360],
    ["48 mo", 48],
    ["5 Year ARM", 60],
  ])("reads %s as %i months", (term, expected) => {
    expect(parseLoanTerm(term)).toBe(expected);
  });

  it("returns null for text with no term in it", () => {
    expect(parseLoanTerm("fixed")).toBeNull();
    expect(parseLoanTerm(null)).toBeNull();
    expect(parseLoanTerm("")).toBeNull();
  });

  it("rejects terms outside the 100-year modelling bound", () => {
    expect(parseLoanTerm("0 year")).toBeNull();
    expect(parseLoanTerm("200 year")).toBeNull();
  });
});

describe("monthsBetweenDays", () => {
  it("counts whole months between origination and payoff", () => {
    expect(monthsBetweenDays(plaidDay("2020-01-01"), plaidDay("2050-01-01"))).toBe(360);
    expect(monthsBetweenDays(plaidDay("2024-03-15"), plaidDay("2029-03-15"))).toBe(60);
  });

  it("returns null when either end is missing", () => {
    expect(monthsBetweenDays(null, plaidDay("2050-01-01"))).toBeNull();
    expect(monthsBetweenDays(plaidDay("2020-01-01"), null)).toBeNull();
  });

  it("returns null for a payoff date at or before origination", () => {
    expect(monthsBetweenDays(plaidDay("2026-01-01"), plaidDay("2026-01-01"))).toBeNull();
    expect(monthsBetweenDays(plaidDay("2026-01-01"), plaidDay("2020-01-01"))).toBeNull();
  });
});
