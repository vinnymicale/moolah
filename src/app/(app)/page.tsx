import Link from "next/link";
import { ArrowRight, CalendarClock, Clock, PiggyBank, Repeat, Target, TrendingDown, TrendingUp } from "lucide-react";
import { requireUser } from "@/lib/session";
import { getNetWorth, getCategories, getTransactionsBetween, getBudgetMonth, getSavingsGoals, getSafeToTransfer, getSpendingAnomalies, getTopMerchants } from "@/lib/queries";
import { getCalendarMonth, getUpcoming } from "@/lib/calendar";
import { getDemoUserId } from "@/lib/demo-session";
import {
  DEMO_TRANSACTIONS, DEMO_BUDGETS, DEMO_GOALS,
} from "@/lib/demo-data";

const DEMO_MODE = process.env.DEMO_MODE === "true";
import { addUTCMonths, endOfUTCMonth, formatWeekdayMonthDay, isoDay, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { formatUSD } from "@/lib/money";
import { INCOME_COLOR, NEGATIVE_COLOR, categoryColor } from "@/lib/colors";
import { CategoryIcon } from "@/components/CategoryIcon";
import { Amount } from "@/components/Amount";
import { PageHeader, StatCard, toneTextClass, type Tone } from "@/components/ui-bits";
import { computeMilestones } from "@/lib/milestones";
import { summarizeDashboard } from "@/lib/dashboard";
import { DashboardSections, type DashboardSection } from "./DashboardSections";
import { SafeTransferCard } from "./SafeTransferCard";
import { SpendingAlertsCard } from "./SpendingAlertsCard";
import { MilestonesBanner } from "./MilestonesBanner";
import { userTodayISO } from "@/lib/user-tz";

export default async function DashboardPage() {
  const todayISO = await userTodayISO();
  const monthFirst = startOfUTCMonth(parseISODay(todayISO));
  const monthISO = isoDay(monthFirst);
  const lastMonthFirst = addUTCMonths(monthFirst, -1);

  const userId = DEMO_MODE
    ? (await getDemoUserId() ?? "")
    : (await requireUser()).userId;

  const [netWorth, calendar, upcoming, categories, monthTxns, budgetLines, lastMonthTxns, goals, safeTransfer, anomalies, topMerchants] = await Promise.all([
    getNetWorth(userId),
    getCalendarMonth(userId, monthISO, todayISO),
    getUpcoming(userId, todayISO, 14),
    getCategories(userId),
    DEMO_MODE
      ? Promise.resolve(DEMO_TRANSACTIONS.filter((t) => t.date >= monthISO && t.date <= isoDay(endOfUTCMonth(monthFirst))))
      : getTransactionsBetween(userId, monthISO, isoDay(endOfUTCMonth(monthFirst))),
    DEMO_MODE ? Promise.resolve(DEMO_BUDGETS) : getBudgetMonth(userId, monthISO),
    DEMO_MODE
      ? Promise.resolve(DEMO_TRANSACTIONS.filter((t) => t.date >= isoDay(lastMonthFirst) && t.date <= isoDay(endOfUTCMonth(lastMonthFirst))))
      : getTransactionsBetween(userId, isoDay(lastMonthFirst), isoDay(endOfUTCMonth(lastMonthFirst))),
    DEMO_MODE ? Promise.resolve(DEMO_GOALS) : getSavingsGoals(userId),
    getSafeToTransfer(userId, todayISO),
    getSpendingAnomalies(userId, monthISO),
    getTopMerchants(userId, monthISO),
  ]);

  const {
    topGoals, goalsSaved, goalsTarget, spendDeltaPct, net, savingsRate,
    projectedEnd, recent, budgeted, totalBudget, budgetSpent,
  } = summarizeDashboard({
    goals,
    monthTxns,
    lastMonthTxns,
    budgetLines,
    monthIncome: calendar.monthIncome,
    monthExpense: calendar.monthExpense,
    projection: calendar.projection,
    anchorBalance: calendar.anchorBalance,
  });

  const catById = new Map(categories.map((c) => [c.id, c]));
  const milestones = computeMilestones({ netWorth: netWorth.net, goals, savingsRate, net });

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
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${categoryColor(cat)}22`, color: categoryColor(cat) }}>
                      <CategoryIcon name={cat?.icon ?? "tag"} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {u.description}
                        {u.recurring && <Repeat size={11} className="ml-1.5 inline text-muted" />}
                      </p>
                      <p className="text-xs text-muted">{formatWeekdayMonthDay(u.date)}</p>
                    </div>
                    <Amount type={u.type} amount={u.amount} className="shrink-0 text-sm font-semibold" />
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
                        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? NEGATIVE_COLOR : b.color }} />
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
                        style={{ backgroundColor: `${categoryColor(cat)}22`, color: categoryColor(cat) }}
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
                        -{formatUSD(m.amount)}
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
                          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: complete ? INCOME_COLOR : g.color }} />
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
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg" style={{ backgroundColor: `${categoryColor(cat)}22`, color: categoryColor(cat) }}>
                      <CategoryIcon name={cat?.icon ?? "tag"} size={15} />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {t.description}
                        {!t.cleared && (
                          <span className="ml-2 inline-flex items-center gap-0.5 align-middle text-[11px] text-warning">
                            <Clock size={11} /> {t.plaidTransactionId ? "pending" : "expected"}
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-muted">{formatWeekdayMonthDay(t.date)}{cat ? ` · ${cat.name}` : ""}</p>
                    </div>
                    <Amount type={t.type} amount={t.amount} className="shrink-0 text-sm font-semibold" />
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
      <PageHeader title="Dashboard" subtitle="Your finances at a glance." />

      <MilestonesBanner milestones={milestones} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Net Worth" value={formatUSD(netWorth.net)} tone="brand" href="/networth" hint={`${formatUSD(netWorth.assets)} assets · ${formatUSD(netWorth.liabilities)} debt`} />
        <StatCard
          label="Income this month"
          value={formatUSD(calendar.monthIncomeActual)}
          tone="income"
          href={`/transactions?m=${monthISO.slice(0, 7)}`}
          hint={`${formatUSD(calendar.monthIncome)} projected by month end`}
        />
        <StatCard
          label="Spent this month"
          value={formatUSD(calendar.monthExpenseActual)}
          tone="expense"
          href={`/transactions?m=${monthISO.slice(0, 7)}`}
          hint={
            <>
              <span>{formatUSD(calendar.monthExpense)} projected by month end</span>
              {spendDeltaPct !== null && (
                <span className={`ml-1 ${spendDeltaPct > 0 ? "text-expense" : spendDeltaPct < 0 ? "text-income" : "text-muted"}`}>
                  · {spendDeltaPct > 0 ? "▲" : spendDeltaPct < 0 ? "▼" : "■"} {Math.abs(spendDeltaPct)}% vs last month
                </span>
              )}
            </>
          }
        />
        <StatCard
          label="Savings rate"
          value={savingsRate === null ? "-" : `${savingsRate}%`}
          tone={savingsRate !== null && savingsRate >= 0 ? "income" : "expense"}
          href="/trends"
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

function Row({ label, value, tone = "default", icon }: { label: string; value: string; tone?: Tone; icon?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className={`flex items-center gap-1.5 tabular-nums font-semibold ${toneTextClass(tone)}`}>{icon}{value}</span>
    </div>
  );
}

function sumUpcoming(items: { type: string; amount: number }[], type: string): number {
  return items.filter((i) => i.type === type).reduce((s, i) => s + i.amount, 0);
}
