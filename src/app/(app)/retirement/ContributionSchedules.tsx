import { formatUSD } from "@/lib/money";
import type { ContributionScheduleDTO } from "@/lib/queries/retirement";

const FREQUENCY_LABEL: Record<ContributionScheduleDTO["frequency"], string> = {
  DAILY: "daily",
  WEEKLY: "weekly",
  BIWEEKLY: "every 2 weeks",
  MONTHLY: "monthly",
  YEARLY: "yearly",
};

const SOURCE_LABEL: Record<ContributionScheduleDTO["source"], string> = {
  EMPLOYEE_PRETAX: "Pre-tax",
  EMPLOYEE_ROTH: "Roth",
  AFTER_TAX: "After-tax",
  EMPLOYER_MATCH: "Employer match",
  ROLLOVER: "Rollover",
};

function cadence(s: ContributionScheduleDTO): string {
  const base = FREQUENCY_LABEL[s.frequency];
  return s.interval > 1 ? `every ${s.interval} × ${base}` : base;
}

/**
 * What the projection actually assumes you contribute, stated both ways. A
 * dollar schedule shows the share of salary it works out to, which is the only
 * place the drift from an intended round percentage becomes visible.
 */
export function ContributionSchedules({
  schedules,
}: {
  schedules: ContributionScheduleDTO[];
}) {
  if (schedules.length === 0) return null;

  return (
    <div className="card mb-5 p-4">
      <h2 className="mb-3 text-sm font-semibold">Your contribution schedule</h2>
      <ul className="space-y-2 text-sm">
        {schedules.map((s) => (
          <li key={s.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
            <span>
              {s.accountName}
              <span className="text-muted"> · {SOURCE_LABEL[s.source]}</span>
            </span>
            <span className="tabular-nums">
              {formatUSD(s.amount)} {cadence(s)}
              {s.percentOfSalary !== null && (
                <span className="text-muted">
                  {" "}
                  · {s.percentOfSalary.toFixed(1)}% of salary
                  {s.basis === "PERCENT_OF_SALARY" && " (set as a percent)"}
                </span>
              )}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-xs text-muted">
        Percent-based schedules rise with your salary. Fixed-dollar ones stay flat, so their share
        of pay shrinks as you get raises.
      </p>
    </div>
  );
}
