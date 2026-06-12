import { requireUser } from "@/lib/session";
import { getBudgetMonth, getBudgetYear } from "@/lib/queries";
import { addUTCMonths, isoDay, monthLabel, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { BudgetsManager } from "./BudgetsManager";
import { BudgetYearView } from "./BudgetYearView";
import { DEMO_BUDGETS } from "@/lib/demo-data";
import { userTodayISO } from "@/lib/user-tz";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; view?: string; y?: string }>;
}) {
  const { m, view, y } = await searchParams;
  const todayISO = await userTodayISO();

  if (!DEMO_MODE && view === "year") {
    const { userId } = await requireUser();
    const year = /^\d{4}$/.test(y ?? "") ? Number(y) : Number(todayISO.slice(0, 4));
    const months = await getBudgetYear(userId, year);
    return (
      <div className="mx-auto max-w-4xl">
        <BudgetYearView months={months} year={year} />
      </div>
    );
  }

  const monthParam = /^\d{4}-\d{2}$/.test(m ?? "") ? `${m}-01` : `${todayISO.slice(0, 7)}-01`;
  const monthFirst = startOfUTCMonth(parseISODay(monthParam));
  const monthISO = isoDay(monthFirst);
  const prevMonthFirst = addUTCMonths(monthFirst, -1);

  const lines = DEMO_MODE
    ? DEMO_BUDGETS
    : await getBudgetMonth((await requireUser()).userId, monthISO);

  return (
    <div className="mx-auto max-w-4xl">
      <BudgetsManager
        lines={lines}
        monthISO={monthISO}
        monthTitle={monthLabel(monthFirst)}
        prevMonthISO={isoDay(prevMonthFirst).slice(0, 7)}
        nextMonthISO={isoDay(addUTCMonths(monthFirst, 1)).slice(0, 7)}
        thisMonthISO={todayISO.slice(0, 7)}
        prevMonthFull={isoDay(prevMonthFirst)}
        prevMonthTitle={monthLabel(prevMonthFirst)}
      />
    </div>
  );
}
