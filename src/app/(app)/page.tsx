import Link from "next/link";
import { ArrowRight, CalendarClock, Repeat, TrendingDown, TrendingUp } from "lucide-react";
import { requireHousehold } from "@/lib/session";
import { getNetWorth, getCategories, getTransactionsBetween } from "@/lib/queries";
import { getCalendarMonth, getUpcoming } from "@/lib/calendar";
import { endOfUTCMonth, isoDay, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { formatUSD } from "@/lib/money";
import { CategoryIcon } from "@/components/CategoryIcon";
import { PageHeader, StatCard } from "@/components/ui-bits";

function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function DashboardPage() {
  const { householdId } = await requireHousehold();
  const todayISO = localTodayISO();
  const monthFirst = startOfUTCMonth(parseISODay(todayISO));
  const monthISO = isoDay(monthFirst);

  const [netWorth, calendar, upcoming, categories, monthTxns] = await Promise.all([
    getNetWorth(householdId),
    getCalendarMonth(householdId, monthISO, todayISO),
    getUpcoming(householdId, todayISO, 14),
    getCategories(householdId),
    getTransactionsBetween(householdId, monthISO, isoDay(endOfUTCMonth(monthFirst))),
  ]);

  const catById = new Map(categories.map((c) => [c.id, c]));
  const net = calendar.monthIncome - calendar.monthExpense;
  const savingsRate = calendar.monthIncome > 0 ? Math.round((net / calendar.monthIncome) * 100) : null;
  const projectedEnd = calendar.projection.at(-1)?.balance ?? calendar.anchorBalance;
  const recent = monthTxns.slice(0, 6);

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Dashboard" subtitle="Your household at a glance." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Net Worth" value={formatUSD(netWorth.net)} tone="brand" hint={`${formatUSD(netWorth.assets)} assets · ${formatUSD(netWorth.liabilities)} debt`} />
        <StatCard label="Income this month" value={formatUSD(calendar.monthIncome)} tone="income" />
        <StatCard label="Spent this month" value={formatUSD(calendar.monthExpense)} tone="expense" />
        <StatCard
          label="Savings rate"
          value={savingsRate === null ? "—" : `${savingsRate}%`}
          tone={savingsRate !== null && savingsRate >= 0 ? "income" : "expense"}
          hint={`Net ${formatUSD(net)}`}
        />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-3">
        {/* Upcoming */}
        <section className="card lg:col-span-2">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 font-semibold">
              <CalendarClock size={18} className="text-brand" /> Upcoming (next 14 days)
            </h2>
            <Link href="/calendar" className="text-sm text-brand hover:underline">
              Calendar <ArrowRight size={14} className="inline" />
            </Link>
          </div>
          {upcoming.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">Nothing scheduled. Add recurring bills to see them here.</p>
          ) : (
            <ul className="divide-y divide-line">
              {upcoming.slice(0, 8).map((u, i) => {
                const cat = u.categoryId ? catById.get(u.categoryId) : undefined;
                return (
                  <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${cat?.color ?? "#64748b"}22`, color: cat?.color ?? "#64748b" }}>
                      <CategoryIcon name={cat?.icon ?? "tag"} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {u.description}
                        {u.recurring && <Repeat size={11} className="ml-1.5 inline text-muted" />}
                      </p>
                      <p className="text-xs text-muted">{formatDay(u.date)}</p>
                    </div>
                    <span className={`shrink-0 tabular-nums text-sm font-semibold ${u.type === "INCOME" ? "text-income" : "text-expense"}`}>
                      {u.type === "INCOME" ? "+" : "−"}
                      {formatUSD(u.amount)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* Cash projection summary */}
        <section className="card p-4">
          <h2 className="mb-3 font-semibold">Cash flow</h2>
          <div className="space-y-3">
            <Row label="Cash on hand today" value={formatUSD(calendar.anchorBalance)} />
            <Row
              label="Projected end of month"
              value={formatUSD(projectedEnd)}
              icon={projectedEnd >= calendar.anchorBalance ? <TrendingUp size={15} className="text-income" /> : <TrendingDown size={15} className="text-expense" />}
            />
            <div className="h-px bg-line" />
            <Row label="Expected income left" value={formatUSD(sumUpcoming(upcoming, "INCOME"))} tone="income" />
            <Row label="Expected expenses left" value={formatUSD(sumUpcoming(upcoming, "EXPENSE"))} tone="expense" />
          </div>
          <Link href="/trends" className="btn-ghost mt-4 w-full">View trends</Link>
        </section>
      </div>

      {/* Recent activity */}
      <section className="card mt-5">
        <div className="flex items-center justify-between border-b border-line px-4 py-3">
          <h2 className="font-semibold">Recent activity</h2>
          <Link href="/transactions" className="text-sm text-brand hover:underline">All transactions <ArrowRight size={14} className="inline" /></Link>
        </div>
        {recent.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-muted">No transactions yet this month.</p>
        ) : (
          <ul className="divide-y divide-line">
            {recent.map((t) => {
              const cat = t.categoryId ? catById.get(t.categoryId) : undefined;
              return (
                <li key={t.id} className="flex items-center gap-3 px-4 py-2.5">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${cat?.color ?? "#64748b"}22`, color: cat?.color ?? "#64748b" }}>
                    <CategoryIcon name={cat?.icon ?? "tag"} size={15} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{t.description}</p>
                    <p className="text-xs text-muted">{formatDay(t.date)}{cat ? ` · ${cat.name}` : ""}</p>
                  </div>
                  <span className={`shrink-0 tabular-nums text-sm font-semibold ${t.type === "INCOME" ? "text-income" : "text-expense"}`}>
                    {t.type === "INCOME" ? "+" : "−"}
                    {formatUSD(t.amount)}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}

function Row({ label, value, tone, icon }: { label: string; value: string; tone?: "income" | "expense"; icon?: React.ReactNode }) {
  const c = tone === "income" ? "text-income" : tone === "expense" ? "text-expense" : "text-text";
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className={`flex items-center gap-1.5 tabular-nums font-semibold ${c}`}>{icon}{value}</span>
    </div>
  );
}

function sumUpcoming(items: { type: string; amount: number }[], type: string): number {
  return items.filter((i) => i.type === type).reduce((s, i) => s + i.amount, 0);
}

function formatDay(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}
