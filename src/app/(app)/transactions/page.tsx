import { requireHousehold } from "@/lib/session";
import { getAccounts, getCategories, getTransactionsBetween } from "@/lib/queries";
import { addUTCMonths, endOfUTCMonth, isoDay, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { PageHeader } from "@/components/ui-bits";
import { TransactionsList } from "./TransactionsList";

function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<{ m?: string }> }) {
  const { householdId } = await requireHousehold();
  const { m } = await searchParams;
  const monthStr = /^\d{4}-\d{2}$/.test(m ?? "") ? (m as string) : thisMonth();
  const monthFirst = startOfUTCMonth(parseISODay(`${monthStr}-01`));
  const monthISO = isoDay(monthFirst);

  const [accounts, categories, transactions] = await Promise.all([
    getAccounts(householdId),
    getCategories(householdId),
    getTransactionsBetween(householdId, monthISO, isoDay(endOfUTCMonth(monthFirst))),
  ]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Transactions" subtitle="Search, filter and export your activity." />
      <TransactionsList
        transactions={transactions}
        accounts={accounts}
        categories={categories}
        monthISO={monthISO}
        prevMonthISO={isoDay(addUTCMonths(monthFirst, -1))}
        nextMonthISO={isoDay(addUTCMonths(monthFirst, 1))}
      />
    </div>
  );
}
