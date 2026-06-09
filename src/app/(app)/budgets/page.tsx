import { requireHousehold } from "@/lib/session";
import { getBudgetMonth, getBudgetYear } from "@/lib/queries";
import { addUTCMonths, isoDay, monthLabel, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { BudgetsManager } from "./BudgetsManager";
import { BudgetYearView } from "./BudgetYearView";
import { DEMO_BUDGETS } from "@/lib/demo-data";

const DEMO_MODE = process.env.DEMO_MODE === "true";

function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function BudgetsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; view?: string; y?: string }>;
}) {
  const { m, view, y } = await searchParams;
  const todayISO = localTodayISO();

  if (!DEMO_MODE && view === "year") {
    const { householdId } = await requireHousehold();
    const year = /^\d{4}$/.test(y ?? "") ? Number(y) : Number(todayISO.slice(0, 4));
    const months = await getBudgetYear(householdId, year);
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
    : await getBudgetMonth((await requireHousehold()).householdId, monthISO);

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
