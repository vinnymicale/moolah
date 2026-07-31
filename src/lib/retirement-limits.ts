// IRS contribution limits, keyed by tax year.
//
// These change every year, so they live here as data rather than being inlined
// into the limit math. An unknown year clamps to the nearest known year and
// reports isFallback so the UI can say "using YYYY limits" instead of quietly
// showing wrong headroom.
//
// Limits apply per person per year across all accounts, not per account: two
// 401k accounts at two employers share one elective-deferral limit.
//
// Verified against official IRS guidance:
// - 2025: Notice 2024-80, https://www.irs.gov/pub/irs-drop/n-24-80.pdf
// - 2026: Notice 2025-67, https://www.irs.gov/newsroom/401k-limit-increases-to-24500-for-2026-ira-limit-increases-to-7500

export interface YearLimits {
  year: number;
  /** Combined employee pre-tax + Roth elective deferral limit (402(g)). */
  electiveDeferral: number;
  /** Elective deferral limit including the age-50+ catch-up. */
  electiveDeferralCatchUp: number;
  /** Employee + employer combined annual additions limit (415(c)). */
  totalAdditions: number;
  /** Traditional + Roth IRA combined contribution limit. */
  iraContribution: number;
  /** IRA limit including the age-50+ catch-up. */
  iraCatchUp: number;
  /** Age at which catch-up contributions become available. */
  catchUpAge: number;
}

const LIMITS: YearLimits[] = [
  {
    year: 2025,
    electiveDeferral: 23_500,
    electiveDeferralCatchUp: 31_000,
    totalAdditions: 70_000,
    iraContribution: 7_000,
    iraCatchUp: 8_000,
    catchUpAge: 50,
  },
  {
    year: 2026,
    electiveDeferral: 24_500,
    electiveDeferralCatchUp: 32_500,
    totalAdditions: 72_000,
    iraContribution: 7_500,
    iraCatchUp: 8_600,
    catchUpAge: 50,
  },
];

export const KNOWN_LIMIT_YEARS = LIMITS.map((l) => l.year);

/**
 * Look up limits for a tax year. Years outside the table clamp to the nearest
 * known year with isFallback set, so callers can surface that the figures are
 * approximate rather than silently reporting wrong headroom.
 */
export function getLimitsForYear(year: number): { limits: YearLimits; isFallback: boolean } {
  const exact = LIMITS.find((l) => l.year === year);
  if (exact) return { limits: exact, isFallback: false };

  const sorted = [...LIMITS].sort((a, b) => a.year - b.year);
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  return { limits: year < earliest.year ? earliest : latest, isFallback: true };
}
