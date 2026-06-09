"use client";

import Link from "next/link";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  BarChart, Bar, PieChart, Pie, Cell,
} from "recharts";
import { formatUSD, formatUSDWhole } from "@/lib/money";
import type { Reports } from "@/lib/reports";

import { BRAND_COLOR, CHART_AXIS_COLOR, INCOME_COLOR, NEGATIVE_COLOR, categoryColor } from "@/lib/colors";
const AXIS = CHART_AXIS_COLOR;
const GRID = "rgba(148,163,184,0.2)";

import type { CategorySlice } from "@/lib/reports";

function CategoryMoMTable({ current, last }: { current: CategorySlice[]; last: CategorySlice[] }) {
  const lastByName = new Map(last.map((s) => [s.name, s.value]));

  // Union of categories that appear in either month, sorted by this month desc.
  const allNames = Array.from(new Set([...current.map((s) => s.name), ...last.map((s) => s.name)]));
  const currentByName = new Map(current.map((s) => [s.name, s]));

  const rows = allNames
    .map((name) => {
      const cur = currentByName.get(name);
      const lastVal = lastByName.get(name) ?? 0;
      const thisVal = cur?.value ?? 0;
      const diff = thisVal - lastVal;
      const pct = lastVal > 0 ? (diff / lastVal) * 100 : null;
      return { name, color: categoryColor(cur), id: cur?.id ?? null, thisVal, lastVal, diff, pct };
    })
    .sort((a, b) => b.thisVal - a.thisVal);

  if (rows.length === 0) return <p className="py-8 text-center text-sm text-muted">No data yet.</p>;

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-line text-xs text-muted">
            <th className="pb-2 text-left font-medium">Category</th>
            <th className="pb-2 text-right font-medium">Last month</th>
            <th className="pb-2 text-right font-medium">This month</th>
            <th className="pb-2 text-right font-medium">Change</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const upBad = r.diff > 0;
            const changeColor = r.pct === null ? "text-muted" : upBad ? "text-expense" : r.diff < 0 ? "text-income" : "text-muted";
            const Icon = r.pct === null || r.diff === 0 ? Minus : upBad ? TrendingUp : TrendingDown;
            return (
              <tr key={r.name} className="group">
                <td className="py-2 pr-4">
                  <Link
                    href={r.id ? `/transactions?category=${r.id}` : `/transactions?category=__uncategorized__`}
                    className="flex items-center gap-2 hover:underline"
                  >
                    <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: r.color }} />
                    {r.name}
                  </Link>
                </td>
                <td className="py-2 pr-4 text-right tabular-nums text-muted">
                  {r.lastVal > 0 ? formatUSD(r.lastVal) : "-"}
                </td>
                <td className="py-2 pr-4 text-right tabular-nums font-medium">
                  {r.thisVal > 0 ? formatUSD(r.thisVal) : "-"}
                </td>
                <td className={`py-2 text-right tabular-nums ${changeColor}`}>
                  <span className="flex items-center justify-end gap-1">
                    <Icon size={13} />
                    {r.pct !== null
                      ? `${r.diff > 0 ? "+" : ""}${Math.round(r.pct)}%`
                      : r.thisVal > 0
                      ? "new"
                      : "gone"}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </div>
  );
}

function MoneyTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-md">
      {label && <p className="mb-1 font-medium">{label}</p>}
      {payload.map((p: any) => (
        <p key={p.name} className="flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: p.color || p.fill }} />
          <span className="text-muted">{p.name}:</span>
          <span className="font-medium tabular-nums">{formatUSD(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

export function TrendsCharts({ reports }: { reports: Reports }) {
  const { netWorthSeries, incomeExpenseSeries, categorySpending, categoryLastMonth, budgetVsActual } = reports;
  const hasSpending = categorySpending.length > 0;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <ChartCard title="Net worth over time">
          <ResponsiveContainer width="100%" height={260}>
            <LineChart data={netWorthSeries} margin={{ left: 8, right: 8, top: 8 }}>
              <CartesianGrid stroke={GRID} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 12 }} tickLine={false} axisLine={false} />
              <YAxis tick={{ fill: AXIS, fontSize: 12 }} tickLine={false} axisLine={false} width={70}
                tickFormatter={(v) => formatUSDWhole(v)} />
              <Tooltip content={<MoneyTooltip />} />
              <Line type="monotone" dataKey="value" name="Net worth" stroke={BRAND_COLOR} strokeWidth={2.5} dot={{ r: 3 }} activeDot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      <ChartCard title="Income vs. expenses (6 months)">
        <ResponsiveContainer width="100%" height={240}>
          <BarChart data={incomeExpenseSeries} margin={{ left: 8, right: 8, top: 8 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="label" tick={{ fill: AXIS, fontSize: 12 }} tickLine={false} axisLine={false} />
            <YAxis tick={{ fill: AXIS, fontSize: 12 }} tickLine={false} axisLine={false} width={60} tickFormatter={(v) => formatUSDWhole(v)} />
            <Tooltip content={<MoneyTooltip />} cursor={{ fill: "rgba(148,163,184,0.1)" }} />
            <Bar dataKey="income" name="Income" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} />
            <Bar dataKey="expense" name="Expenses" fill={NEGATIVE_COLOR} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartCard>

      <ChartCard title="Spending by category (this month)">
        {hasSpending ? (
          <div className="flex items-center gap-4">
            <ResponsiveContainer width="50%" height={220}>
              <PieChart>
                <Pie data={categorySpending} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={48} outerRadius={88} paddingAngle={2}>
                  {categorySpending.map((s) => (
                    <Cell key={s.name} fill={s.color} stroke="transparent" />
                  ))}
                </Pie>
                <Tooltip content={<MoneyTooltip />} />
              </PieChart>
            </ResponsiveContainer>
            <ul className="flex-1 space-y-1.5 overflow-y-auto" style={{ maxHeight: 220 }}>
              {categorySpending.slice(0, 8).map((s) => (
                <li key={s.name}>
                  <Link
                    href={s.id ? `/transactions?category=${s.id}` : "/transactions"}
                    className="flex items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-surface2"
                    title={`View ${s.name} transactions`}
                  >
                    <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                    <span className="flex-1 truncate text-muted">{s.name}</span>
                    <span className="tabular-nums font-medium">{formatUSD(s.value)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted">No spending recorded this month yet.</p>
        )}
      </ChartCard>

      {(categorySpending.length > 0 || categoryLastMonth.length > 0) && (
        <div className="lg:col-span-2">
          <ChartCard title="Category spending - this month vs. last month">
            <CategoryMoMTable current={categorySpending} last={categoryLastMonth} />
          </ChartCard>
        </div>
      )}

      <ChartCard title="Budget vs. actual (this month)">
        {budgetVsActual.length > 0 ? (
          <div className="space-y-3 py-1">
            {budgetVsActual.map((b) => {
              const pct = b.budget > 0 ? Math.min(100, (b.actual / b.budget) * 100) : 0;
              const over = b.actual > b.budget;
              return (
                <div key={b.name}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="font-medium">{b.name}</span>
                    <span className={`tabular-nums ${over ? "text-expense" : "text-muted"}`}>
                      {formatUSD(b.actual)} / {formatUSD(b.budget)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface2">
                    <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? NEGATIVE_COLOR : b.color }} />
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="py-12 text-center text-sm text-muted">
            No budgets set. Add monthly limits to categories to track them here.
          </p>
        )}
      </ChartCard>
    </div>
  );
}
