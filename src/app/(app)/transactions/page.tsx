import { requireHousehold } from "@/lib/session";
import { getAccounts, getCategories, getTransactionsBetween } from "@/lib/queries";
import { addUTCMonths, endOfUTCMonth, isoDay, monthLabel, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { PageHeader } from "@/components/ui-bits";
import { TransactionsList } from "./TransactionsList";

const RANGES = new Set(["month", "3m", "12m", "ytd", "all"]);

function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; account?: string; range?: string; category?: string }>;
}) {
  const { householdId } = await requireHousehold();
  const { m, account, range: rangeParam, category } = await searchParams;
  const range = RANGES.has(rangeParam ?? "") ? (rangeParam as string) : "month";

  const todayISO = localTodayISO();
  const today = parseISODay(todayISO);
  const monthStr = /^\d{4}-\d{2}$/.test(m ?? "") ? (m as string) : todayISO.slice(0, 7);
  const monthFirst = startOfUTCMonth(parseISODay(`${monthStr}-01`));
  const monthISO = isoDay(monthFirst);

  let startISO: string;
  let endISO: string;
  let rangeLabel: string;
  switch (range) {
    case "3m":
      startISO = isoDay(startOfUTCMonth(addUTCMonths(today, -2)));
      endISO = isoDay(endOfUTCMonth(today));
      rangeLabel = "Last 3 months";
      break;
    case "12m":
      startISO = isoDay(startOfUTCMonth(addUTCMonths(today, -11)));
      endISO = isoDay(endOfUTCMonth(today));
      rangeLabel = "Last 12 months";
      break;
    case "ytd":
      startISO = `${todayISO.slice(0, 4)}-01-01`;
      endISO = isoDay(endOfUTCMonth(today));
      rangeLabel = `${todayISO.slice(0, 4)} year to date`;
      break;
    case "all":
      startISO = "1970-01-01";
      endISO = "2999-12-31";
      rangeLabel = "All time";
      break;
    default:
      startISO = monthISO;
      endISO = isoDay(endOfUTCMonth(monthFirst));
      rangeLabel = monthLabel(monthFirst);
  }

  const [accounts, categories, transactions] = await Promise.all([
    getAccounts(householdId),
    getCategories(householdId),
    getTransactionsBetween(householdId, startISO, endISO),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Transactions" subtitle="Search, filter and export your activity." />
      <TransactionsList
        transactions={transactions}
        accounts={accounts}
        categories={categories}
        range={range}
        rangeLabel={rangeLabel}
        monthISO={monthISO}
        prevMonthISO={isoDay(addUTCMonths(monthFirst, -1))}
        nextMonthISO={isoDay(addUTCMonths(monthFirst, 1))}
        initialAccountId={account && accounts.some((a) => a.id === account) ? account : ""}
        initialCategoryId={
          category === "__uncategorized__" ? "__uncategorized__" :
          (category && categories.some((c) => c.id === category) ? category : "")
        }
      />
    </div>
  );
}
