import Link from "next/link";
import { AlertTriangle } from "lucide-react";
import { CategoryIcon } from "@/components/CategoryIcon";
import { formatUSD } from "@/lib/money";
import type { SpendingAnomalyDTO } from "@/lib/queries";

export function SpendingAlertsCard({ anomalies }: { anomalies: SpendingAnomalyDTO[] }) {
  if (anomalies.length === 0) return null;

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-line bg-warning/5 px-4 py-3">
        <AlertTriangle size={17} className="shrink-0 text-warning" />
        <h2 className="font-semibold">Spending alerts</h2>
        <span className="ml-auto rounded-full bg-warning/15 px-2 py-0.5 text-xs font-medium text-warning">
          {anomalies.length} {anomalies.length === 1 ? "category" : "categories"} over trend
        </span>
      </div>
      <ul className="divide-y divide-line">
        {anomalies.map((a) => (
          <li key={a.categoryId}>
            <Link
              href={`/transactions?category=${a.categoryId}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-surface2"
            >
              <span
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
                style={{ backgroundColor: `${a.color}22`, color: a.color }}
              >
                <CategoryIcon name={a.icon} size={15} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{a.name}</p>
                <p className="text-xs text-muted">
                  3-month avg {formatUSD(a.avg3Month)}
                </p>
              </div>
              <div className="text-right">
                <p className="tabular-nums text-sm font-semibold text-expense">
                  {formatUSD(a.thisMonth)}
                </p>
                <p className="text-xs text-warning">
                  +{a.overPct}% (+{formatUSD(a.overBy)})
                </p>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
