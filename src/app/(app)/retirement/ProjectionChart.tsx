"use client";

import { useMemo } from "react";
import {
  ResponsiveContainer, ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ReferenceLine,
} from "recharts";
import { formatUSD, formatUSDWhole } from "@/lib/money";
import { ChartSkeleton } from "@/components/ChartSkeleton";
import { useChartTheme } from "@/lib/useChartTheme";
import { useMounted } from "@/lib/useMounted";
import { usePrefersReducedMotion } from "@/lib/usePrefersReducedMotion";
import type { ProjectionPoint } from "@/lib/retirement-projection";

// Dimmer than theme.brand so the Coast FIRE line reads as secondary without a new hue.
const COAST_OPACITY = 0.5;

interface Row {
  date: string;
  balance?: number;
  coast?: number;
}

function shortDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${m}/${d}/${y.slice(2)}`;
}

interface TooltipEntry {
  name?: string;
  value?: number | string;
  color?: string;
}

function ProjectionTooltip({ active, payload, label }: { active?: boolean; payload?: TooltipEntry[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium">{shortDate(label)}</p>}
      {payload
        .filter((p) => p.value !== undefined && p.value !== null)
        .map((p) => (
          <p key={p.name} className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color }} />
            <span className="text-muted">{p.name}:</span>
            <span className="font-medium money">{formatUSD(p.value)}</span>
          </p>
        ))}
    </div>
  );
}

export function ProjectionChart({
  points,
  coastPoints,
  target,
}: {
  points: ProjectionPoint[];
  coastPoints: ProjectionPoint[];
  target: number;
}) {
  const theme = useChartTheme();
  const reducedMotion = usePrefersReducedMotion();
  const mounted = useMounted();

  const data = useMemo<Row[]>(() => {
    const rows: Row[] = points.map((p) => ({ date: p.date, balance: p.balance }));
    const coastByDate = new Map(coastPoints.map((p) => [p.date, p.balance]));
    for (const row of rows) {
      const coast = coastByDate.get(row.date);
      if (coast !== undefined) row.coast = coast;
    }
    return rows;
  }, [points, coastPoints]);

  return (
    <div className="card mb-5 p-4">
      <h2 className="mb-3 text-sm font-semibold">Projected balance</h2>
      {!mounted ? (
        <ChartSkeleton height={320} />
      ) : (
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={data} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid stroke={theme.grid} vertical={false} />
            <XAxis dataKey="date" tick={{ fill: theme.axis, fontSize: 12 }} tickLine={false} axisLine={false}
              tickFormatter={shortDate} minTickGap={40} />
            <YAxis tick={{ fill: theme.axis, fontSize: 12 }} tickLine={false} axisLine={false} width={70}
              tickFormatter={(v) => formatUSDWhole(v)} />
            <Tooltip content={<ProjectionTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <ReferenceLine y={target} stroke={theme.axis} strokeDasharray="3 3"
              label={{ value: "Target", position: "insideTopLeft", fill: theme.axis, fontSize: 11 }} />
            <Line type="monotone" dataKey="balance" name="Projected" stroke={theme.brand}
              strokeWidth={2.5} dot={false} activeDot={{ r: 5 }} isAnimationActive={!reducedMotion} />
            <Line type="monotone" dataKey="coast" name="Coast FIRE" stroke={theme.brand}
              strokeOpacity={COAST_OPACITY} strokeWidth={1.5} strokeDasharray="5 4" dot={false}
              isAnimationActive={!reducedMotion} />
          </ComposedChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}
