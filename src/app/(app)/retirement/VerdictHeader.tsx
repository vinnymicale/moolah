import { TriangleAlert, CircleCheck } from "lucide-react";
import { formatUSDWhole } from "@/lib/money";
import type { ProjectionResult } from "@/lib/retirement-projection";
import type { RetirementTarget } from "@/lib/retirement-target";
import type { RequiredSavings } from "@/lib/required-savings";

export function VerdictHeader({
  projection,
  target,
  requiredSavings,
}: {
  projection: ProjectionResult;
  target: RetirementTarget;
  requiredSavings: RequiredSavings;
}) {
  const onTrack = requiredSavings.onTrack;
  const cls = onTrack
    ? "border-income/30 bg-income/10 text-income"
    : "border-expense/30 bg-expense/10 text-expense";

  return (
    <div className={`mb-5 flex items-start gap-2 rounded-lg border px-4 py-3 text-sm ${cls}`}>
      {onTrack ? (
        <CircleCheck size={18} className="mt-0.5 shrink-0" />
      ) : (
        <TriangleAlert size={18} className="mt-0.5 shrink-0" />
      )}
      <p>
        {onTrack ? (
          <>
            You&apos;re on track. Projected balance of {formatUSDWhole(projection.finalBalance)}{" "}
            meets your {formatUSDWhole(target.target)} target.
          </>
        ) : (
          <>
            Behind by {formatUSDWhole(requiredSavings.shortfallMonthly)}/month to reach your{" "}
            {formatUSDWhole(target.target)} target.
          </>
        )}
      </p>
    </div>
  );
}

export function RequiredSavingsPanel({ requiredSavings }: { requiredSavings: RequiredSavings }) {
  return (
    <div className="card mb-5 p-4">
      <h2 className="mb-3 text-sm font-semibold">Required savings</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Required monthly</p>
          <p className="money mt-1 text-lg font-semibold">
            {formatUSDWhole(requiredSavings.requiredMonthly)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Current monthly</p>
          <p className="money mt-1 text-lg font-semibold">
            {formatUSDWhole(requiredSavings.currentMonthly)}
          </p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Percent of salary</p>
          <p className="money mt-1 text-lg font-semibold">
            {requiredSavings.percentOfSalary === null
              ? "-"
              : `${requiredSavings.percentOfSalary.toFixed(1)}%`}
          </p>
        </div>
      </div>
    </div>
  );
}
