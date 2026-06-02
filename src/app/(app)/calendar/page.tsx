import { requireHousehold } from "@/lib/session";
import { getAccounts, getCategories } from "@/lib/queries";
import { getCalendarMonth } from "@/lib/calendar";
import { addUTCMonths, isoDay, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { CalendarView } from "./CalendarView";

function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { householdId } = await requireHousehold();
  const { m } = await searchParams;

  const todayISO = localTodayISO();
  const monthParam = /^\d{4}-\d{2}$/.test(m ?? "") ? `${m}-01` : `${todayISO.slice(0, 7)}-01`;
  const monthFirst = startOfUTCMonth(parseISODay(monthParam));
  const monthISO = isoDay(monthFirst);

  const [accounts, categories, data] = await Promise.all([
    getAccounts(householdId),
    getCategories(householdId),
    getCalendarMonth(householdId, monthISO, todayISO),
  ]);

  return (
    <div className="mx-auto max-w-6xl">
      <CalendarView
        data={data}
        accounts={accounts}
        categories={categories}
        monthISO={monthISO}
        prevMonthISO={isoDay(addUTCMonths(monthFirst, -1))}
        nextMonthISO={isoDay(addUTCMonths(monthFirst, 1))}
        thisMonthISO={`${todayISO.slice(0, 7)}-01`}
      />
    </div>
  );
}
