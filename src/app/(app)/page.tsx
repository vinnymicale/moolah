import Link from "next/link";
import { ArrowRight, CalendarClock, PiggyBank, Repeat, Target, TrendingDown, TrendingUp } from "lucide-react";
import { requireHousehold } from "@/lib/session";
import { getNetWorth, getCategories, getTransactionsBetween, getBudgetMonth, getSavingsGoals, getSafeToTransfer, getSpendingAnomalies, getTopMerchants } from "@/lib/queries";
import { getCalendarMonth, getUpcoming } from "@/lib/calendar";
import { addUTCMonths, endOfUTCMonth, isoDay, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { formatUSD } from "@/lib/money";
import { CategoryIcon } from "@/components/CategoryIcon";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { DashboardSections, type DashboardSection } from "./DashboardSections";
import { SafeTransferCard } from "./SafeTransferCard";
import { SpendingAlertsCard } from "./SpendingAlertsCard";

function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function DashboardPage() {
  const { householdId } = await requireHousehold();
  const todayISO = localTodayISO();
  const monthFirst = startOfUTCMonth(parseISODay(todayISO));
  const monthISO = isoDay(monthFirst);

  const lastMonthFirst = addUTCMonths(monthFirst, -1);
  const [netWorth, calendar, upcoming, categories, monthTxns, budgetLines, lastMonthTxns, goals, safeTransfer, anomalies, topMerchants] = await Promise.all([
    getNetWorth(householdId),
    getCalendarMonth(householdId, monthISO, todayISO),
    getUpcoming(householdId, todayISO, 14),
    getCategories(householdId),
    getTransactionsBetween(householdId, monthISO, isoDay(endOfUTCMonth(monthFirst))),
    getBudgetMonth(householdId, monthISO),
    getTransactionsBetween(householdId, isoDay(lastMonthFirst), isoDay(endOfUTCMonth(lastMonthFirst))),
    getSavingsGoals(householdId),
    getSafeToTransfer(householdId, todayISO),
    getSpendingAnomalies(householdId, monthISO),
    getTopMerchants(householdId, monthISO),
  ]);

  const topGoals = goals.slice(0, 3);
  const goalsSaved = goals.reduce((s, g) => s + g.currentAmount, 0);
  const goalsTarget = goals.reduce((s, g) => s + g.targetAmount, 0);

  const lastMonthExpense = lastMonthTxns.filter((t) => t.type === "EXPENSE").reduce((s, t) => s + t.amount, 0);
  const spendDeltaPct = lastMonthExpense > 0 ? Math.round(((calendar.monthExpense - lastMonthExpense) / lastMonthExpense) * 100) : null;

  const catById = new Map(categories.map((c) => [c.id, c]));
  const net = calendar.monthIncome - calendar.monthExpense;
  const savingsRate = calendar.monthIncome > 0 ? Math.round((net / calendar.monthIncome) * 100) : null;
  const projectedEnd = calendar.projection.at(-1)?.balance ?? calendar.anchorBalance;
  const recent = monthTxns.slice(0, 6);

  const budgeted = budgetLines.filter((b) => b.limit > 0).sort((a, b) => b.limit - a.limit);
  const totalBudget = budgeted.reduce((s, b) => s + b.limit, 0);
  const budgetSpent = budgeted.reduce((s, b) => s + b.actual, 0);

  const sections: DashboardSection[] = [
    {
      id: "upcoming",
      node: (
        <section className="card">
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
      ),
    },
    {
      id: "cashflow",
      node: (
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
      ),
    },
    {
      id: "budgets",
      node: (
        <section className="card">
          <div className="flex items-center justify-between border-b border-line px-4 py-3">
            <h2 className="flex items-center gap-2 font-semibold">
              <PiggyBank size={18} className="text-brand" /> Budgets this month
            </h2>
            <Link href="/budgets" className="text-sm text-brand hover:underline">
              Manage <ArrowRight size={14} className="inline" />
            </Link>
          </div>
          {budgeted.length === 0 ? (
            <p className="px-4 py-8 text-center text-sm text-muted">
              No budgets set. <Link href="/budgets" className="text-brand hover:underline">Set monthly limits</Link> to track spending here.
            </p>
          ) : (
            <div className="px-4 py-3">
              <div className="mb-3 flex items-center justify-between text-sm">
                <span className="text-muted">{formatUSD(budgetSpent)} of {formatUSD(totalBudget)} spent</span>
                <span className={`font-semibold tabular-nums ${totalBudget - budgetSpent >= 0 ? "text-income" : "text-expense"}`}>
                  {formatUSD(totalBudget - budgetSpent)} left
                </span>
              </div>
              <ul className="space-y-2.5">
                {budgeted.slice(0, 4).map((b) => {
                  const pct = b.limit > 0 ? Math.min(100, (b.actual / b.limit) * 100) : 0;
                  const over = b.actual > b.limit;
                  return (
                    <li key={b.categoryId}>
                      <div className="mb-1 flex justify-between text-xs">
                        <Link href={`/transactions?category=${b.categoryId}`} className="font-medium hover:text-brand hover:underline">
                          {b.name}
                        </Link>
                        <span className={`tabular-nums ${over ? "text-expense" : "text-muted"}`}>
                          {formatUSD(b.actual)} / {formatUSD(b.limit)}
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? "#dc2626" : b.color }} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </section>
      ),
    },
    ...(anomalies.length > 0
      ? [{
          id: "alerts",
          node: <SpendingAlertsCard anomalies={anomalies} />,
        }]
      : []),
    ...(topMerchants.length > 0
      ? [{
          id: "merchants",
          node: (
            <section className="card">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="font-semibold">Top payees this month</h2>
                <Link href="/transactions" className="text-sm text-brand hover:underline">
                  All transactions <ArrowRight size={14} className="inline" />
                </Link>
              </div>
              <ul className="divide-y divide-line">
                {topMerchants.map((m, i) => {
                  const cat = m.categoryId ? catById.get(m.categoryId) : undefined;
                  return (
                    <li key={i} className="flex items-center gap-3 px-4 py-2.5">
                      <span
                        className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-bold tabular-nums"
                        style={{ backgroundColor: `${cat?.color ?? "#64748b"}22`, color: cat?.color ?? "#64748b" }}
                      >
                        {i + 1}
                      </span>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{m.description}</p>
                        <p className="text-xs text-muted">
                          {cat ? cat.name : "Uncategorized"} · {m.count} {m.count === 1 ? "charge" : "charges"}
                        </p>
                      </div>
                      <span className="shrink-0 tabular-nums text-sm font-semibold text-expense">
                        −{formatUSD(m.amount)}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </section>
          ),
        }]
      : []),
    ...(goals.length > 0
      ? [{
          id: "goals",
          node: (
            <section className="card">
              <div className="flex items-center justify-between border-b border-line px-4 py-3">
                <h2 className="flex items-center gap-2 font-semibold">
                  <Target size={18} className="text-brand" /> Savings goals
                </h2>
                <Link href="/goals" className="text-sm text-brand hover:underline">
                  Manage <ArrowRight size={14} className="inline" />
                </Link>
              </div>
              <div className="px-4 py-3">
                <div className="mb-3 text-sm text-muted">
                  Saved <span className="font-semibold text-text">{formatUSD(goalsSaved)}</span> of {formatUSD(goalsTarget)}
                </div>
                <ul className="space-y-2.5">
                  {topGoals.map((g) => {
                    const pct = g.targetAmount > 0 ? Math.min(100, (g.currentAmount / g.targetAmount) * 100) : 0;
                    const complete = g.currentAmount >= g.targetAmount;
                    return (
                      <li key={g.id}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="flex items-center gap-1.5 font-medium">
                            <span className="flex h-5 w-5 items-center justify-center rounded" style={{ backgroundColor: `${g.color}22`, color: g.color }}>
                              <CategoryIcon name={g.icon} size={12} />
                            </span>
                            {g.name}
                          </span>
                          <span className="tabular-nums text-muted">
                            {formatUSD(g.currentAmount)} / {formatUSD(g.targetAmount)} · {Math.round(pct)}%
                          </span>
                        </div>
                        <div className="h-1.5 overflow-hidden rounded-full bg-surface2">
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: complete ? "#16a34a" : g.color }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </section>
          ),
        }]
      : []),
    {
      id: "recent",
      node: (
        <section className="card">
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
      ),
    },
  ];

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeader title="Dashboard" subtitle="Your household at a glance." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Net Worth" value={formatUSD(netWorth.net)} tone="brand" hint={`${formatUSD(netWorth.assets)} assets · ${formatUSD(netWorth.liabilities)} debt`} />
        <StatCard label="Income this month" value={formatUSD(calendar.monthIncome)} tone="income" />
        <StatCard
          label="Spent this month"
          value={formatUSD(calendar.monthExpense)}
          tone="expense"
          hint={
            spendDeltaPct === null ? undefined : (
              <span className={spendDeltaPct > 0 ? "text-expense" : spendDeltaPct < 0 ? "text-income" : "text-muted"}>
                {spendDeltaPct > 0 ? "▲" : spendDeltaPct < 0 ? "▼" : "■"} {Math.abs(spendDeltaPct)}% vs last month
              </span>
            )
          }
        />
        <StatCard
          label="Savings rate"
          value={savingsRate === null ? "—" : `${savingsRate}%`}
          tone={savingsRate !== null && savingsRate >= 0 ? "income" : "expense"}
          hint={`Net ${formatUSD(net)}`}
        />
      </div>

      <div className="mt-5">
        {safeTransfer.show && (
          <SafeTransferCard data={safeTransfer} goals={goals} />
        )}
        <DashboardSections sections={sections} />
      </div>
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
