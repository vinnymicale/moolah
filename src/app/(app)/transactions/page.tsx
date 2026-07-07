import { requireUser } from "@/lib/session";
import { getAccounts, getCategories, getTransactionsPage, type TransactionsPageDTO } from "@/lib/queries";
import { addUTCMonths, isoDay, parseISODay } from "@/lib/dates";
import { PageHeader } from "@/components/ui-bits";
import { TransactionsList } from "./TransactionsList";
import { resolveTransactionsRange } from "./resolve-range";
import { filterTransactionDTOs, paginateTransactionDTOs, parseTransactionFilters } from "./transactions-utils";
import { DEMO_ACCOUNTS, DEMO_CATEGORIES, DEMO_TRANSACTIONS } from "@/lib/demo-data";
import { userTodayISO } from "@/lib/user-tz";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{
    m?: string; range?: string; from?: string; to?: string;
    q?: string; type?: string; status?: string; category?: string; account?: string;
    page?: string; focus?: string;
  }>;
}) {
  const params = await searchParams;
  const userId = DEMO_MODE ? "" : (await requireUser()).userId;
  const todayISO = await userTodayISO();
  const { range, monthISO, startISO, endISO, rangeLabel } = resolveTransactionsRange(params, todayISO);
  const monthFirst = parseISODay(monthISO);

  const [accounts, categories] = DEMO_MODE
    ? [DEMO_ACCOUNTS, DEMO_CATEGORIES]
    : await Promise.all([getAccounts(userId), getCategories(userId)]);

  // Validate id filters from the URL against real rows, keeping only ids that
  // exist (plus the "uncategorized" / "no account" sentinels).
  const catIds = new Set(categories.map((c) => c.id));
  const acctIds = new Set(accounts.map((a) => a.id));
  const filters = parseTransactionFilters(params);
  filters.categoryIds = filters.categoryIds.filter((v) => v === "__uncategorized__" || catIds.has(v));
  filters.accountIds = filters.accountIds.filter((v) => v === "__none__" || acctIds.has(v));
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  let txnPage: TransactionsPageDTO;
  if (DEMO_MODE) {
    const inRange = DEMO_TRANSACTIONS.filter((t) => t.date >= startISO && t.date <= endISO);
    const catNames = new Map(categories.map((c) => [c.id, c.name]));
    txnPage = paginateTransactionDTOs(filterTransactionDTOs(inRange, filters, catNames), page);
  } else {
    txnPage = await getTransactionsPage(userId, startISO, endISO, filters, page);
  }

  return (
    <div className="stagger mx-auto max-w-4xl">
      <PageHeader title="Transactions" subtitle="Search, filter and export your activity." />
      <TransactionsList
        txnPage={txnPage}
        accounts={accounts}
        categories={categories}
        range={range}
        rangeLabel={rangeLabel}
        monthISO={monthISO}
        prevMonthISO={isoDay(addUTCMonths(monthFirst, -1))}
        nextMonthISO={isoDay(addUTCMonths(monthFirst, 1))}
        initialSearch={filters.search}
        initialTypes={filters.types.join(",")}
        initialStatuses={filters.statuses.join(",")}
        initialCategoryId={filters.categoryIds.join(",")}
        initialAccountId={filters.accountIds.join(",")}
        focusId={params.focus ?? ""}
        customFrom={range === "custom" ? startISO : ""}
        customTo={range === "custom" ? endISO : ""}
      />
    </div>
  );
}
