import { requireUser } from "@/lib/session";
import { getNetWorth } from "@/lib/queries";
import { getNetWorthHistory } from "@/lib/snapshots";
import { forecastNetWorth } from "@/lib/networth-forecast";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { TriangleAlert } from "lucide-react";
import { NetWorthChart } from "./NetWorthChart";
import { getDemoUserId } from "@/lib/demo-session";
import { userTodayISO } from "@/lib/user-tz";

const DEMO_MODE = process.env.DEMO_MODE === "true";

// One year of daily history backs the page; the client trims it to the chosen
// range. A year of points is small (≤365) and lets range switching stay local.
const HISTORY_DAYS = 366;
const FORECAST_MONTHS = 12;

// "2026-09-14" -> "Sep 2026" for the projection banner.
function formatShort(iso: string): string {
  const [y, m] = iso.split("-");
  const month = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][Number(m) - 1];
  return `${month} ${y}`;
}

export default async function NetWorthPage() {
  const userId = DEMO_MODE ? (await getDemoUserId()) ?? "" : (await requireUser()).userId;
  const today = await userTodayISO();

  const [history, current] = await Promise.all([
    getNetWorthHistory(userId, HISTORY_DAYS, today),
    getNetWorth(userId),
  ]);
  const forecast = await forecastNetWorth(userId, current.net, FORECAST_MONTHS, today);

  // Year-to-date change: net now minus net on the first point of the year held.
  const startNet = history[0]?.net ?? current.net;
  const ytd = current.net - startNet;
  const ytdPct = startNet !== 0 ? (ytd / Math.abs(startNet)) * 100 : null;

  // Flag a worrying trajectory: net worth projected to go negative, or to fall
  // more than 10% below where it stands today by the end of the horizon.
  const lowPoint = forecast.reduce(
    (min, p) => (p.net < min.net ? p : min),
    { date: today, net: current.net },
  );
  const end = forecast.at(-1);
  const goesNegative = lowPoint.net < 0;
  const fallsSharply =
    current.net > 0 && end !== undefined && end.net < current.net * 0.9;
  const warn = goesNegative || fallsSharply;

  return (
    <div className="stagger mx-auto max-w-5xl">
      <PageHeader title="Net Worth" subtitle="Your assets minus liabilities, tracked over time." />

      {warn && (
        <div className="mb-5 flex items-start gap-2 rounded-lg border border-expense/30 bg-expense/10 px-4 py-3 text-sm text-expense">
          <TriangleAlert size={18} className="mt-0.5 shrink-0" />
          <p>
            {goesNegative
              ? `On your current recurring schedule, net worth is projected to dip to $${Math.round(lowPoint.net).toLocaleString()} around ${formatShort(lowPoint.date)}.`
              : `Heads up: your recurring income and expenses project net worth falling to about $${Math.round(end!.net).toLocaleString()} over the next year.`}
          </p>
        </div>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Net worth"
          value={`$${Math.round(current.net).toLocaleString()}`}
          tone={current.net >= 0 ? "income" : "expense"}
        />
        <StatCard
          label="Assets"
          value={`$${Math.round(current.assets).toLocaleString()}`}
          tone="income"
        />
        <StatCard
          label="Liabilities"
          value={`$${Math.round(current.liabilities).toLocaleString()}`}
          tone="expense"
        />
      </div>

      <NetWorthChart history={history} forecast={forecast} ytd={ytd} ytdPct={ytdPct} />
    </div>
  );
}
