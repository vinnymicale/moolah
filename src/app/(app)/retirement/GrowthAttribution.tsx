import { TriangleAlert } from "lucide-react";
import { formatSigned, formatUSDWhole } from "@/lib/money";
import type { GrowthAttribution as GrowthAttributionData } from "@/lib/retirement-growth";

function monthLabel(ym: string): string {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function GrowthAttribution({ growth }: { growth: GrowthAttributionData }) {
  return (
    <div className="card mb-5 p-4">
      <h2 className="mb-3 text-sm font-semibold">Growth, last 12 months</h2>
      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Balance change</p>
          <p className="money mt-1 text-lg font-semibold">{formatSigned(growth.balanceDelta)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Contributed</p>
          <p className="money mt-1 text-lg font-semibold">{formatUSDWhole(growth.contributed)}</p>
        </div>
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">Market return</p>
          <p className="money mt-1 text-lg font-semibold">
            {formatSigned(growth.marketReturn)}
            {growth.marketReturnPercent !== null && (
              <span className="ml-1 text-sm text-muted">
                ({growth.marketReturnPercent >= 0 ? "+" : ""}
                {growth.marketReturnPercent.toFixed(1)}%)
              </span>
            )}
          </p>
        </div>
      </div>

      {!growth.confident && (
        <p className="mt-4 flex items-start gap-2 rounded-lg border border-line bg-surface2 px-3 py-2 text-sm text-muted">
          <TriangleAlert size={16} className="mt-0.5 shrink-0" />
          No contributions recorded for {growth.gapMonths.map(monthLabel).join(", ")}. Market
          return may be overstated.
        </p>
      )}
    </div>
  );
}
