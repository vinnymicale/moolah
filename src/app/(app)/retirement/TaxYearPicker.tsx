"use client";

import { useRouter } from "next/navigation";

// The year lives in the URL rather than component state so the server can
// recompute the limits, the YTD totals and the contribution log against the
// same year in one pass.
export function TaxYearPicker({ year, years }: { year: number; years: number[] }) {
  const router = useRouter();
  if (years.length < 2) return null;
  return (
    <label className="flex items-center gap-2 text-xs text-muted">
      <span className="sr-only">Tax year</span>
      <select
        className="input py-1 text-xs"
        value={year}
        onChange={(e) => router.push(`/retirement?year=${e.target.value}`)}
      >
        {years.map((y) => (
          <option key={y} value={y}>
            {y}
          </option>
        ))}
      </select>
    </label>
  );
}
