// Federal marginal income tax brackets and the standard deduction, keyed by tax
// year and filing status.
//
// These exist to estimate one number: the marginal rate a retirement
// contribution is deducted at (traditional) or taxed at (Roth). That's a
// deliberately narrow job. We model ordinary income against the standard
// deduction only - no itemising, no credits, no state tax, no capital gains
// stacking - because the traditional-vs-Roth call turns on which side of a
// bracket you sit, and that survives the simplification.
//
// Like retirement-limits.ts, an unknown year clamps to the nearest known year
// and reports isFallback so the UI can say the figures are approximate.
//
// Verified against official IRS guidance:
// - 2025: Rev. Proc. 2024-40, https://www.irs.gov/pub/irs-drop/rp-24-40.pdf
// - 2026: Rev. Proc. 2025-32, https://www.irs.gov/pub/irs-drop/rp-25-32.pdf

import type { FilingStatus } from "@/generated/prisma/enums";

/** One bracket: `rate` percent applies to income above `from` up to the next bracket. */
export interface TaxBracket {
  readonly rate: number;
  readonly from: number;
}

export interface YearTaxTable {
  readonly year: number;
  readonly standardDeduction: Readonly<Record<FilingStatus, number>>;
  readonly brackets: Readonly<Record<FilingStatus, readonly TaxBracket[]>>;
}

// Married-filing-separately mirrors single through the 35% bracket and differs
// only at the top, where the 37% threshold is half the joint figure.
const TABLES: readonly YearTaxTable[] = Object.freeze([
  Object.freeze({
    year: 2025,
    standardDeduction: Object.freeze({
      SINGLE: 15_000,
      MARRIED_JOINT: 30_000,
      MARRIED_SEPARATE: 15_000,
      HEAD_OF_HOUSEHOLD: 22_500,
    }),
    brackets: Object.freeze({
      SINGLE: Object.freeze([
        { rate: 10, from: 0 },
        { rate: 12, from: 11_925 },
        { rate: 22, from: 48_475 },
        { rate: 24, from: 103_350 },
        { rate: 32, from: 197_300 },
        { rate: 35, from: 250_525 },
        { rate: 37, from: 626_350 },
      ]),
      MARRIED_JOINT: Object.freeze([
        { rate: 10, from: 0 },
        { rate: 12, from: 23_850 },
        { rate: 22, from: 96_950 },
        { rate: 24, from: 206_700 },
        { rate: 32, from: 394_600 },
        { rate: 35, from: 501_050 },
        { rate: 37, from: 751_600 },
      ]),
      MARRIED_SEPARATE: Object.freeze([
        { rate: 10, from: 0 },
        { rate: 12, from: 11_925 },
        { rate: 22, from: 48_475 },
        { rate: 24, from: 103_350 },
        { rate: 32, from: 197_300 },
        { rate: 35, from: 250_525 },
        { rate: 37, from: 375_800 },
      ]),
      HEAD_OF_HOUSEHOLD: Object.freeze([
        { rate: 10, from: 0 },
        { rate: 12, from: 17_000 },
        { rate: 22, from: 64_850 },
        { rate: 24, from: 103_350 },
        { rate: 32, from: 197_300 },
        { rate: 35, from: 250_500 },
        { rate: 37, from: 626_350 },
      ]),
    }),
  }),
  Object.freeze({
    year: 2026,
    standardDeduction: Object.freeze({
      SINGLE: 16_100,
      MARRIED_JOINT: 32_200,
      MARRIED_SEPARATE: 16_100,
      HEAD_OF_HOUSEHOLD: 24_150,
    }),
    brackets: Object.freeze({
      SINGLE: Object.freeze([
        { rate: 10, from: 0 },
        { rate: 12, from: 12_400 },
        { rate: 22, from: 50_400 },
        { rate: 24, from: 105_700 },
        { rate: 32, from: 201_775 },
        { rate: 35, from: 256_225 },
        { rate: 37, from: 640_600 },
      ]),
      MARRIED_JOINT: Object.freeze([
        { rate: 10, from: 0 },
        { rate: 12, from: 24_800 },
        { rate: 22, from: 100_800 },
        { rate: 24, from: 211_400 },
        { rate: 32, from: 403_550 },
        { rate: 35, from: 512_450 },
        { rate: 37, from: 768_700 },
      ]),
      MARRIED_SEPARATE: Object.freeze([
        { rate: 10, from: 0 },
        { rate: 12, from: 12_400 },
        { rate: 22, from: 50_400 },
        { rate: 24, from: 105_700 },
        { rate: 32, from: 201_775 },
        { rate: 35, from: 256_225 },
        { rate: 37, from: 384_350 },
      ]),
      HEAD_OF_HOUSEHOLD: Object.freeze([
        { rate: 10, from: 0 },
        { rate: 12, from: 17_700 },
        { rate: 22, from: 67_450 },
        { rate: 24, from: 105_700 },
        { rate: 32, from: 201_775 },
        { rate: 35, from: 256_200 },
        { rate: 37, from: 640_600 },
      ]),
    }),
  }),
]);

export const KNOWN_TAX_YEARS: readonly number[] = Object.freeze(TABLES.map((t) => t.year));

/**
 * Filing status to read the table under. Anything unrecognised - an older plan
 * row, a status the tables don't break out - reads as single, which is the
 * conservative default the schema uses.
 */
function statusKey(filingStatus: FilingStatus): FilingStatus {
  return filingStatus in TABLES[0].brackets ? filingStatus : "SINGLE";
}

/** Look up the tax table for a year, clamping to the nearest known year. */
export function getTaxTableForYear(year: number): { table: Readonly<YearTaxTable>; isFallback: boolean } {
  const exact = TABLES.find((t) => t.year === year);
  if (exact) return { table: exact, isFallback: false };

  const sorted = [...TABLES].sort((a, b) => a.year - b.year);
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  return { table: year < earliest.year ? earliest : latest, isFallback: true };
}

/**
 * The marginal rate on the last dollar of taxable income.
 *
 * `grossIncome` is gross wages; the standard deduction is subtracted here.
 * Income at or below the deduction has no marginal rate to speak of, so this
 * returns the bottom bracket rather than zero - a contribution there still
 * can't deduct against nothing, which the caller handles separately.
 */
export function marginalRate({
  grossIncome,
  filingStatus,
  year,
}: {
  grossIncome: number;
  filingStatus: FilingStatus;
  year: number;
}): { rate: number; taxableIncome: number; isFallback: boolean } {
  const { table, isFallback } = getTaxTableForYear(year);
  const status = statusKey(filingStatus);
  const taxableIncome = Math.max(0, grossIncome - table.standardDeduction[status]);
  const brackets = table.brackets[status];

  let rate = brackets[0].rate;
  for (const b of brackets) {
    if (taxableIncome >= b.from) rate = b.rate;
    else break;
  }
  return { rate, taxableIncome, isFallback };
}

/**
 * Where the next `amount` of pre-tax deferral lands: the rate it saves at, and
 * whether it drops you into a lower bracket along the way.
 *
 * Deferring across a bracket edge saves at a blend of the two rates, so we
 * report both the top rate and the effective rate on the whole deferral. The
 * blended figure is what makes "your first $6k saves at 22%, the rest at 12%"
 * expressible.
 */
export function deferralSavings({
  grossIncome,
  amount,
  filingStatus,
  year,
}: {
  grossIncome: number;
  amount: number;
  filingStatus: FilingStatus;
  year: number;
}): { topRate: number; effectiveRate: number; crossesBracket: boolean } {
  const top = marginalRate({ grossIncome, filingStatus, year });
  if (amount <= 0) {
    return { topRate: top.rate, effectiveRate: top.rate, crossesBracket: false };
  }

  const after = marginalRate({ grossIncome: grossIncome - amount, filingStatus, year });
  if (after.rate === top.rate) {
    return { topRate: top.rate, effectiveRate: top.rate, crossesBracket: false };
  }

  // Walk the deferral down through each bracket it passes, weighting each
  // slice's rate by the dollars that fall in it.
  const { table } = getTaxTableForYear(year);
  const brackets = table.brackets[statusKey(filingStatus)];
  let remaining = amount;
  let cursor = top.taxableIncome;
  let saved = 0;
  for (let i = brackets.length - 1; i >= 0 && remaining > 0; i--) {
    const b = brackets[i];
    if (cursor <= b.from) continue;
    const slice = Math.min(remaining, cursor - b.from);
    saved += slice * (b.rate / 100);
    remaining -= slice;
    cursor = b.from;
  }
  return {
    topRate: top.rate,
    effectiveRate: amount > 0 ? (saved / amount) * 100 : top.rate,
    crossesBracket: true,
  };
}
