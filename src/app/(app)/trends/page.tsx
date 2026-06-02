import { requireHousehold } from "@/lib/session";
import { computeReports } from "@/lib/reports";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { TrendsCharts } from "./TrendsCharts";

function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function TrendsPage() {
  const { householdId } = await requireHousehold();
  const reports = await computeReports(householdId, localTodayISO());

  const latestNet = reports.netWorthSeries.at(-1)?.value ?? 0;
  const firstNet = reports.netWorthSeries[0]?.value ?? 0;
  const change = latestNet - firstNet;

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Trends" subtitle={`Insights for ${reports.currentMonthLabel}.`} />

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Net worth (12-mo change)"
          value={`${change >= 0 ? "+" : "−"}$${Math.abs(Math.round(change)).toLocaleString()}`}
          tone={change >= 0 ? "income" : "expense"}
        />
        <StatCard
          label="Savings rate (this month)"
          value={reports.savingsRate === null ? "—" : `${reports.savingsRate}%`}
          tone={reports.savingsRate !== null && reports.savingsRate >= 0 ? "income" : "expense"}
        />
        <StatCard
          label="Net this month"
          value={`$${Math.round((reports.incomeExpenseSeries.at(-1)?.net ?? 0)).toLocaleString()}`}
        />
      </div>

      <TrendsCharts reports={reports} />
    </div>
  );
}
