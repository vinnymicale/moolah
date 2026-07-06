"use client";

import { useMemo, useState } from "react";
import {
  ResponsiveContainer, ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { TrendingUp, TrendingDown } from "lucide-react";
import { formatUSD, formatUSDWhole } from "@/lib/money";
import { ChartSkeleton } from "@/components/ChartSkeleton";
import { useChartTheme } from "@/lib/useChartTheme";
import { useMounted } from "@/lib/useMounted";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import type { NetWorthPoint } from "@/lib/snapshots";
import type { ForecastPoint } from "@/lib/networth-forecast";

const FORECAST_COLOR = "#a855f7";

type Range = "3M" | "1Y" | "ALL";
const RANGES: { key: Range; label: string; days: number | null }[] = [
  { key: "3M", label: "3M", days: 90 },
  { key: "1Y", label: "1Y", days: 365 },
  { key: "ALL", label: "All", days: null },
];

// A unified row for the composed chart. History rows carry net/assets/liabilities;
// forecast rows carry only the dashed `projected` value.
interface Row {
  date: string;
  net?: number;
  assets?: number;
  liabilities?: number;
  projected?: number;
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
  fill?: string;
}

function NetWorthTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium">{shortDate(label)}</p>}
      {payload
        .filter((p) => p.value !== undefined && p.value !== null)
        .map((p) => (
          <p key={p.name} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
            <span className="text-muted">{p.name}:</span>
            <span className="font-medium money">{formatUSD(p.value)}</span>
          </p>
        ))}
    </div>
  );
}

export function NetWorthChart({
  history,
  forecast,
  ytd,
  ytdPct,
}: {
  history: NetWorthPoint[];
  forecast: ForecastPoint[];
  ytd: number;
  ytdPct: number | null;
}) {
  const [range, setRange] = useState<Range>("1Y");
  const [showForecast, setShowForecast] = useState(true);
  const theme = useChartTheme();
  const reducedMotion = usePrefersReducedMotion();
  // Hold the chart's height with a skeleton until the client has mounted, so the
  // chart fades in rather than popping in over an empty box.
  const mounted = useMounted();

  const data = useMemo<Row[]>(() => {
    const days = RANGES.find((r) => r.key === range)!.days;
    const trimmed = days === null ? history : history.slice(Math.max(0, history.length - days));
    const rows: Row[] = trimmed.map((p) => ({
      date: p.date,
      net: p.net,
      assets: p.assets,
      liabilities: -p.liabilities, // plot debt below the axis
    }));
    if (showForecast && forecast.length > 0) {
      // Anchor the forecast line to the last historical point so it connects.
      const last = trimmed.at(-1);
      if (last) rows[rows.length - 1] = { ...rows[rows.length - 1], projected: last.net };
      for (const f of forecast) rows.push({ date: f.date, projected: f.net });
    }
    return rows;
  }, [history, forecast, range, showForecast]);

  const up = ytd >= 0;
  const hasHistory = history.some((p) => p.net !== 0 || p.assets !== 0 || p.liabilities !== 0);

  return (
    <div className="card p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold">Net worth over time</h2>
          {hasHistory && (
            <span
              className={`flex items-center gap-1 text-sm font-medium ${up ? "text-income" : "text-expense"}`}
              title="Change over the period shown"
            >
              {up ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
              {up ? "+" : "-"}${Math.abs(Math.round(ytd)).toLocaleString()}
              {ytdPct !== null && <span className="text-muted">({up ? "+" : ""}{Math.round(ytdPct)}%)</span>}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-1.5 text-xs text-muted">
            <input
              type="checkbox"
              checked={showForecast}
              onChange={(e) => setShowForecast(e.target.checked)}
              className="accent-[var(--brand,#4f46e5)]"
            />
            Forecast
          </label>
          <div className="flex overflow-hidden rounded-lg border border-line text-xs">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`px-2.5 py-1 ${range === r.key ? "bg-brand text-brand-fg" : "hover:bg-surface2"}`}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {hasHistory ? (
        !mounted ? (
          <ChartSkeleton height={320} />
        ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid stroke={theme.grid} vertical={false} />
            <XAxis dataKey="date" tick={{ fill: theme.axis, fontSize: 12 }} tickLine={false} axisLine={false}
              tickFormatter={shortDate} minTickGap={40} />
            <YAxis tick={{ fill: theme.axis, fontSize: 12 }} tickLine={false} axisLine={false} width={70}
              tickFormatter={(v) => formatUSDWhole(v)} />
            <Tooltip content={<NetWorthTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Area type="monotone" dataKey="assets" name="Assets" stroke={theme.income}
              fill={theme.income} fillOpacity={0.12} strokeWidth={1.5} dot={false} isAnimationActive={!reducedMotion} />
            {/* Dashed so Liabilities is distinguishable from Assets without relying on color. */}
            <Area type="monotone" dataKey="liabilities" name="Liabilities" stroke={theme.expense}
              fill={theme.expense} fillOpacity={0.12} strokeWidth={1.5} strokeDasharray="4 3" dot={false} isAnimationActive={!reducedMotion} />
            <Line type="monotone" dataKey="net" name="Net worth" stroke={theme.brand}
              strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} isAnimationActive={!reducedMotion} />
            <Line type="monotone" dataKey="projected" name="Forecast" stroke={FORECAST_COLOR}
              strokeWidth={2} strokeDasharray="5 4" dot={false} connectNulls isAnimationActive={!reducedMotion} />
          </ComposedChart>
        </ResponsiveContainer>
        )
      ) : (
        <p className="py-16 text-center text-sm text-muted">
          No history yet. Snapshots are recorded each time your accounts sync - check back after your
          next sync, or run the backfill to seed today&apos;s starting point.
        </p>
      )}
    </div>
  );
}
