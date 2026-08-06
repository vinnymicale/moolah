import { describe, it, expect } from "vitest";
import {
  buildSchedule,
  paymentForTerm,
  compareExtraPayment,
  byYear,
  loanProgress,
} from "./amortization";

// Reference case used throughout: a $300,000 loan at 6% over 30 years. The
// standard amortization formula puts the payment at $1,798.6515..., and the
// textbook lifetime interest is $347,514.57.
//
// The unrounded payment matters. Paying the cent-rounded $1,798.65 leaves a few
// cents of principal behind every month, which compounds into a 361st stub
// payment - real behavior, pinned by its own test below, but not what the
// closed-form reference figures describe.
const EXACT_PAYMENT = paymentForTerm(300000, 6, 360, { round: false });
const MORTGAGE = { balance: 300000, apr: 6, payment: EXACT_PAYMENT };

describe("paymentForTerm", () => {
  it("matches the standard amortizing-loan formula", () => {
    expect(paymentForTerm(300000, 6, 360)).toBeCloseTo(1798.65, 1);
  });

  it("rounds to the cent by default and returns the exact figure on request", () => {
    expect(paymentForTerm(300000, 6, 360)).toBe(1798.65);
    expect(paymentForTerm(300000, 6, 360, { round: false })).toBeCloseTo(1798.6515754, 6);
  });

  it("round-trips: its own payment retires the loan in exactly the term", () => {
    const p = paymentForTerm(250000, 4.5, 240, { round: false });
    expect(buildSchedule({ balance: 250000, apr: 4.5, payment: p }).months).toBe(240);
  });

  it("handles a zero-interest loan as a straight division", () => {
    expect(paymentForTerm(12000, 0, 24)).toBe(500);
  });

  it("returns zero for a cleared balance or an empty term", () => {
    expect(paymentForTerm(0, 6, 360)).toBe(0);
    expect(paymentForTerm(1000, 6, 0)).toBe(0);
  });
});

describe("buildSchedule", () => {
  it("retires the reference mortgage in 360 payments", () => {
    const s = buildSchedule(MORTGAGE);
    expect(s.feasible).toBe(true);
    expect(s.months).toBe(360);
    expect(s.rows[s.rows.length - 1].balance).toBe(0);
  });

  it("totals lifetime interest to the textbook figure", () => {
    const s = buildSchedule(MORTGAGE);
    expect(s.totalInterest).toBeCloseTo(347514.57, 1);
  });

  it("leaves a stub payment when the lender's rounded payment is used", () => {
    // $1,798.65 is the quoted payment, a hair under the exact figure. Those
    // fractions of a cent compound into one small final payment.
    const s = buildSchedule({ balance: 300000, apr: 6, payment: 1798.65 });
    expect(s.months).toBe(361);
    expect(s.rows[360].payment).toBeLessThan(10);
    expect(s.rows[360].balance).toBe(0);
  });

  it("splits the first payment mostly into interest", () => {
    const first = buildSchedule(MORTGAGE).rows[0];
    expect(first.interest).toBe(1500); // 300000 * 6% / 12
    expect(first.principal).toBeCloseTo(298.65, 2);
    expect(first.period).toBe(1);
  });

  it("crosses over so the final payment is mostly principal", () => {
    const rows = buildSchedule(MORTGAGE).rows;
    const last = rows[rows.length - 1];
    expect(last.principal).toBeGreaterThan(last.interest * 100);
  });

  it("keeps principal + interest equal to the payment on every row", () => {
    // Each field is rounded to the cent independently, so the split can land a
    // cent off the payment it came from.
    for (const r of buildSchedule(MORTGAGE).rows) {
      expect(Math.abs(r.principal + r.interest - r.payment)).toBeLessThanOrEqual(0.01);
    }
  });

  it("trims the final payment instead of overshooting into a negative balance", () => {
    const s = buildSchedule({ balance: 1000, apr: 12, payment: 400 });
    const last = s.rows[s.rows.length - 1];
    expect(last.balance).toBe(0);
    expect(last.payment).toBeLessThan(400);
    expect(s.rows.every((r) => r.balance >= 0)).toBe(true);
  });

  it("amortizes a zero-interest loan as pure principal", () => {
    const s = buildSchedule({ balance: 1200, apr: 0, payment: 100 });
    expect(s.months).toBe(12);
    expect(s.totalInterest).toBe(0);
    expect(s.totalPaid).toBe(1200);
  });

  it("reports infeasible when the payment doesn't cover monthly interest", () => {
    const s = buildSchedule({ balance: 300000, apr: 6, payment: 1000 });
    expect(s.feasible).toBe(false);
    expect(s.reason).toMatch(/balance would grow/);
    expect(s.rows).toEqual([]);
  });

  it("reports infeasible when the payment exactly equals the interest", () => {
    // 300000 * 6% / 12 = 1500 exactly - this never touches principal.
    expect(buildSchedule({ balance: 300000, apr: 6, payment: 1500 }).feasible).toBe(false);
  });

  it("rejects a zero payment on an interest-free loan", () => {
    const s = buildSchedule({ balance: 1000, apr: 0, payment: 0 });
    expect(s.feasible).toBe(false);
    expect(s.reason).toMatch(/greater than zero/);
  });

  it("returns an empty schedule for an already-cleared loan", () => {
    const s = buildSchedule({ balance: 0, apr: 6, payment: 500 });
    expect(s).toEqual({ feasible: true, rows: [], months: 0, totalInterest: 0, totalPaid: 0 });
  });

  it("totals paid to principal plus interest", () => {
    const s = buildSchedule(MORTGAGE);
    expect(s.totalPaid).toBeCloseTo(300000 + s.totalInterest, 0);
  });
});

describe("compareExtraPayment", () => {
  it("shortens the reference mortgage and saves interest", () => {
    const c = compareExtraPayment(MORTGAGE, 200)!;
    expect(c.monthsSaved).toBeGreaterThan(0);
    expect(c.interestSaved).toBeGreaterThan(0);
    expect(c.accelerated.months).toBe(c.base.months - c.monthsSaved);
  });

  it("saves 81 months and ~$91k for $200/mo extra", () => {
    // $200/mo extra clears this 30-year loan in 279 months (23.3 years).
    const c = compareExtraPayment(MORTGAGE, 200)!;
    expect(c.accelerated.months).toBe(279);
    expect(c.monthsSaved).toBe(81);
    expect(c.interestSaved).toBeCloseTo(91173, -2);
  });

  it("changes nothing when the extra is zero", () => {
    const c = compareExtraPayment(MORTGAGE, 0)!;
    expect(c.monthsSaved).toBe(0);
    expect(c.interestSaved).toBe(0);
  });

  it("treats a negative extra as zero rather than extending the loan", () => {
    const c = compareExtraPayment(MORTGAGE, -500)!;
    expect(c.monthsSaved).toBe(0);
    expect(c.accelerated.months).toBe(c.base.months);
  });

  it("returns null when the underlying loan is infeasible", () => {
    expect(compareExtraPayment({ balance: 300000, apr: 6, payment: 1000 }, 100)).toBeNull();
  });

  it("more extra always saves at least as much", () => {
    const small = compareExtraPayment(MORTGAGE, 100)!;
    const large = compareExtraPayment(MORTGAGE, 500)!;
    expect(large.interestSaved).toBeGreaterThan(small.interestSaved);
    expect(large.monthsSaved).toBeGreaterThanOrEqual(small.monthsSaved);
  });
});

describe("byYear", () => {
  it("rolls 360 monthly rows into 30 years", () => {
    const years = byYear(buildSchedule(MORTGAGE).rows);
    expect(years).toHaveLength(30);
    expect(years[0].year).toBe(1);
    expect(years[29].balance).toBe(0);
  });

  it("shifts from interest-heavy to principal-heavy across the term", () => {
    const years = byYear(buildSchedule(MORTGAGE).rows);
    expect(years[0].interest).toBeGreaterThan(years[0].principal);
    expect(years[29].principal).toBeGreaterThan(years[29].interest);
  });

  it("keeps yearly principal summing to the original balance", () => {
    const years = byYear(buildSchedule(MORTGAGE).rows);
    const total = years.reduce((s, y) => s + y.principal, 0);
    expect(total).toBeCloseTo(300000, 0);
  });

  it("handles a partial final year", () => {
    // 14 payments -> two buckets, the second holding only 2 months.
    const rows = buildSchedule({ balance: 1400, apr: 0, payment: 100 }).rows;
    const years = byYear(rows);
    expect(years).toHaveLength(2);
    expect(years[1].principal).toBe(200);
  });

  it("returns nothing for an empty schedule", () => {
    expect(byYear([])).toEqual([]);
  });
});

describe("buildSchedule rejects terms it can't model", () => {
  it("is infeasible when the payment can't clear the balance within a century", () => {
    // A cent above the monthly interest clears the underwater guard but would
    // take millennia. Reporting a 100-year schedule with the balance nearly
    // untouched would be worse than saying no.
    const s = buildSchedule({ balance: 300000, apr: 6, payment: 1500.01 });
    expect(s.feasible).toBe(false);
    expect(s.reason).toMatch(/over 100 years/);
    expect(s.rows).toEqual([]);
    expect(s.months).toBe(0);
  });

  it("stays feasible for a payment that clears just inside the cap", () => {
    const s = buildSchedule({ balance: 10000, apr: 0, payment: 10 });
    expect(s.feasible).toBe(true);
    expect(s.months).toBe(1000);
  });

  it("rejects a negative interest rate", () => {
    const s = buildSchedule({ balance: 1000, apr: -5, payment: 100 });
    expect(s.feasible).toBe(false);
    expect(s.reason).toMatch(/negative/);
  });

  it.each([
    ["apr", { balance: 300000, apr: NaN, payment: 1798.65 }],
    ["payment", { balance: 300000, apr: 6, payment: NaN }],
    ["balance", { balance: NaN, apr: 6, payment: 1798.65 }],
    ["infinite balance", { balance: Infinity, apr: 6, payment: 1798.65 }],
  ])("rejects a non-finite %s instead of emitting NaN rows", (_label, terms) => {
    const s = buildSchedule(terms);
    expect(s.feasible).toBe(false);
    expect(s.rows).toEqual([]);
    // NaN used to slip through and serialize as null over the wire.
    expect(JSON.stringify(s)).not.toContain("null");
  });
});

describe("paymentForTerm guards", () => {
  it("returns zero for a non-positive term", () => {
    expect(paymentForTerm(1000, 5, 0)).toBe(0);
    expect(paymentForTerm(1000, 5, -12)).toBe(0);
  });

  it("returns zero rather than NaN for non-finite inputs", () => {
    expect(paymentForTerm(1000, NaN, 12)).toBe(0);
    expect(paymentForTerm(NaN, 5, 12)).toBe(0);
    expect(paymentForTerm(1000, 5, NaN)).toBe(0);
  });

  it("returns zero for a negative rate", () => {
    expect(paymentForTerm(1000, -5, 12)).toBe(0);
  });

  it("round-trips: its payment retires the loan in exactly that term", () => {
    for (const months of [12, 60, 180, 360]) {
      const payment = paymentForTerm(250000, 4.5, months, { round: false });
      expect(buildSchedule({ balance: 250000, apr: 4.5, payment }).months).toBe(months);
    }
  });
});

describe("compareExtraPayment guards", () => {
  it("returns null when the base schedule is infeasible", () => {
    expect(compareExtraPayment({ balance: 300000, apr: 6, payment: 100 }, 50)).toBeNull();
  });

  it("returns null for a non-finite extra payment", () => {
    expect(compareExtraPayment(MORTGAGE, NaN)).toBeNull();
  });

  it("treats a negative extra as no extra", () => {
    const c = compareExtraPayment(MORTGAGE, -500);
    expect(c?.monthsSaved).toBe(0);
    expect(c?.interestSaved).toBe(0);
  });
});

describe("loanProgress", () => {
  it("returns null without an origination date", () => {
    expect(loanProgress(null, 360, "2026-08-05")).toBeNull();
  });

  it("counts whole months elapsed against the term", () => {
    const p = loanProgress("2024-03-01", 60, "2026-08-05")!;
    expect(p.monthsElapsed).toBe(29);
    expect(p.monthsRemaining).toBe(31);
    expect(p.pastTerm).toBe(false);
  });

  it("does not count a month until its day-of-month comes around", () => {
    expect(loanProgress("2026-01-20", 12, "2026-02-19")!.monthsElapsed).toBe(0);
    expect(loanProgress("2026-01-20", 12, "2026-02-20")!.monthsElapsed).toBe(1);
  });

  it("floors elapsed months at zero for a future origination date", () => {
    const p = loanProgress("2027-01-01", 60, "2026-08-05")!;
    expect(p.monthsElapsed).toBe(0);
    expect(p.fractionElapsed).toBe(0);
  });

  it("flags a loan past its original term without going negative", () => {
    const p = loanProgress("2019-01-01", 60, "2026-08-05")!;
    expect(p.pastTerm).toBe(true);
    expect(p.monthsRemaining).toBe(0);
    expect(p.fractionElapsed).toBe(1);
  });

  it("reports elapsed months only when no term was recorded", () => {
    const p = loanProgress("2024-08-05", null, "2026-08-05")!;
    expect(p.monthsElapsed).toBe(24);
    expect(p.monthsRemaining).toBeNull();
    expect(p.fractionElapsed).toBeNull();
    expect(p.pastTerm).toBe(false);
  });

  it("returns null for an unparseable date", () => {
    expect(loanProgress("not-a-date", 60, "2026-08-05")).toBeNull();
  });
});
