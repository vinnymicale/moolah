import { ArrowRight, Info, TriangleAlert } from "lucide-react";
import { formatUSDWhole } from "@/lib/money";
import type { AccountAdvice as AccountAdviceData, ContributionLean } from "@/lib/account-advice";

const LEAN_LABEL: Record<ContributionLean, string> = {
  TRADITIONAL: "Lean traditional",
  ROTH: "Lean Roth",
  SPLIT: "Split traditional and Roth",
};

const LEAN_TAG: Record<ContributionLean, string> = {
  TRADITIONAL: "Traditional",
  ROTH: "Roth",
  SPLIT: "Either",
};

export function AccountAdvice({ advice }: { advice: AccountAdviceData }) {
  return (
    <div className="card mb-5 p-4">
      <h2 className="mb-3 text-sm font-semibold">Where to put the next dollar</h2>

      <div className="rounded-lg border border-line bg-surface2 px-3 py-3">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-semibold">{LEAN_LABEL[advice.lean]}</p>
          <p className="text-xs text-muted">
            {advice.currentMarginalRate}% marginal now vs. about {advice.projectedRetirementRate}% in
            retirement
          </p>
        </div>
        <p className="mt-1 text-sm text-muted">{advice.leanReason}</p>
      </div>

      <ol className="mt-4 space-y-3">
        {advice.steps.map((step) => (
          <li key={step.key} className="flex items-start gap-3">
            <ArrowRight
              size={16}
              className={`mt-1 shrink-0 ${step.priority === "critical" ? "text-fg" : "text-muted"}`}
            />
            <div className="min-w-0">
              <p className={`text-sm ${step.priority === "normal" ? "" : "font-semibold"}`}>
                {step.title}
                {step.lean && (
                  <span className="ml-2 rounded border border-line px-1.5 py-0.5 text-xs text-muted">
                    {LEAN_TAG[step.lean]}
                  </span>
                )}
              </p>
              <p className="mt-0.5 text-sm text-muted">{step.detail}</p>
              {step.amount !== null && step.amount > 0 && (
                <p className="money mt-0.5 text-sm">{formatUSDWhole(step.amount)}</p>
              )}
            </div>
          </li>
        ))}
      </ol>

      {advice.isFallbackYear && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-muted">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          The IRS hasn&apos;t published limits for this year yet, so the nearest year&apos;s figures are used.
        </p>
      )}

      <p className="mt-4 flex items-start gap-2 text-xs text-muted">
        <Info size={14} className="mt-0.5 shrink-0" />
        Based on federal brackets and the standard deduction for your filing status. It ignores
        state tax, itemised deductions, and other income, any of which can change the answer. Not
        tax advice.
      </p>
    </div>
  );
}
