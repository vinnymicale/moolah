import { requireUser } from "@/lib/session";
import { getAccounts, getCategories } from "@/lib/queries";
import { getCalendarMonth } from "@/lib/calendar";
import { addUTCMonths, isoDay, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { CalendarView } from "./CalendarView";
import { getDemoUserId } from "@/lib/demo-session";
import { userTodayISO } from "@/lib/user-tz";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string }>;
}) {
  const { m } = await searchParams;
  const todayISO = await userTodayISO();
  const monthParam = /^\d{4}-\d{2}$/.test(m ?? "") ? `${m}-01` : `${todayISO.slice(0, 7)}-01`;
  const monthFirst = startOfUTCMonth(parseISODay(monthParam));
  const monthISO = isoDay(monthFirst);

  const userId = DEMO_MODE
    ? (await getDemoUserId() ?? "")
    : (await requireUser()).userId;

  const [accounts, categories, data] = await Promise.all([
    getAccounts(userId),
    getCategories(userId),
    getCalendarMonth(userId, monthISO, todayISO),
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
