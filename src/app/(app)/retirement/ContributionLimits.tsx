import { formatUSDWhole } from "@/lib/money";
import type { ContributionLimitReport, LimitUsage } from "@/lib/contribution-limits";
import type { RetirementAccountDTO, YtdContributionDTO } from "@/lib/queries/retirement";
import { YtdContributionForm } from "./YtdContributionForm";

function LimitBar({ usage }: { usage: LimitUsage }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-sm">
        <span>{usage.label}</span>
        <span className="text-muted">
          {formatUSDWhole(usage.used)} / {formatUSDWhole(usage.limit)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-surface2">
        <div
          className="h-full rounded-full bg-brand"
          style={{ width: `${Math.min(100, usage.percentUsed)}%` }}
        />
      </div>
    </div>
  );
}

export function ContributionLimits({
  limits,
  accounts,
  ytdContributions,
}: {
  limits: ContributionLimitReport;
  accounts: RetirementAccountDTO[];
  ytdContributions: YtdContributionDTO[];
}) {
  return (
    <div className="card mb-5 p-4">
      <h2 className="mb-3 text-sm font-semibold">Contribution limits ({limits.year})</h2>
      <div className="space-y-4">
        <LimitBar usage={limits.electiveDeferral} />
        <LimitBar usage={limits.totalAdditions} />
        <LimitBar usage={limits.ira} />
      </div>

      {limits.match && limits.match.forfeited > 0 && (
        <p className="mt-4 rounded-lg border border-expense/30 bg-expense/10 px-3 py-2 text-sm text-expense">
          You&apos;re on pace to leave {formatUSDWhole(limits.match.forfeited)} of employer match
          unclaimed this year.
        </p>
      )}

      {limits.isFallbackYear && (
        <p className="mt-3 text-xs text-muted">
          Figures use the most recent published limits.
        </p>
      )}

      <YtdContributionForm
        accounts={accounts}
        ytdContributions={ytdContributions}
        year={limits.year}
        usesYtdOverride={limits.usesYtdOverride}
      />
    </div>
  );
}
