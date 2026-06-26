import Link from "next/link";
import { ChevronLeft, ChevronRight, CalendarDays } from "lucide-react";
import { StatCard } from "@/components/ui-bits";
import { formatUSD } from "@/lib/money";
import type { BudgetMonthSummaryDTO } from "@/lib/queries";

export function BudgetYearView({
  months,
  year,
}: {
  months: BudgetMonthSummaryDTO[];
  year: number;
}) {
  const totalBudget = months.reduce((s, m) => s + m.budget, 0);
  const totalActual = months.reduce((s, m) => s + m.actual, 0);
  const budgetedMonths = months.filter((m) => m.budget > 0);
  const avgActual = months.reduce((s, m) => s + m.actual, 0) / 12;

  return (
    <div>
      {/* Toolbar */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Link href={`/budgets?view=year&y=${year - 1}`} className="btn-ghost h-9 w-9 !p-0" aria-label="Previous year">
            <ChevronLeft size={18} />
          </Link>
          <h1 className="min-w-24 text-center text-lg font-semibold md:text-xl">{year}</h1>
          <Link href={`/budgets?view=year&y=${year + 1}`} className="btn-ghost h-9 w-9 !p-0" aria-label="Next year">
            <ChevronRight size={18} />
          </Link>
        </div>
        <Link href="/budgets" className="btn-ghost h-9 text-sm">
          <CalendarDays size={15} /> Month view
        </Link>
      </div>

      {/* Summary */}
      <div className="mb-5 grid gap-4 sm:grid-cols-3">
        <StatCard label="Budgeted (year)" value={formatUSD(totalBudget)} hint={`${budgetedMonths.length} of 12 months budgeted`} />
        <StatCard label="Spent (year)" value={formatUSD(totalActual)} tone="expense" hint={`${formatUSD(avgActual)}/mo average`} />
        <StatCard
          label="Net vs. budget"
          value={formatUSD(totalBudget - totalActual)}
          tone={totalBudget - totalActual >= 0 ? "income" : "expense"}
        />
      </div>

      {/* Per-month table */}
      <div className="card overflow-hidden">
        <div className="border-b border-line px-4 py-3 font-semibold">Month by month</div>
        <ul className="divide-y divide-line">
          {months.map((m) => {
            const pct = m.budget > 0 ? Math.min(100, (m.actual / m.budget) * 100) : 0;
            const over = m.budget > 0 && m.actual > m.budget;
            return (
              <li key={m.monthISO}>
                <Link href={`/budgets?m=${m.monthISO.slice(0, 7)}`} className="block px-4 py-3 hover:bg-surface2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium">{m.label}</span>
                    <span className={`tabular-nums ${over ? "text-expense" : "text-muted"}`}>
                      {formatUSD(m.actual)}
                      {m.budget > 0 ? ` / ${formatUSD(m.budget)}` : " · no budget"}
                    </span>
                  </div>
                  {m.budget > 0 && (
                    <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface2">
                      <div className="h-full rounded-full" style={{ width: `${pct}%`, background: over ? "var(--expense)" : "var(--income)" }} />
                    </div>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
