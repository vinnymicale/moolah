import { requireHousehold } from "@/lib/session";
import { getAccounts, getCategories, getTransactionsBetween } from "@/lib/queries";
import { addUTCMonths, endOfUTCMonth, isoDay, monthLabel, parseISODay, startOfUTCMonth } from "@/lib/dates";
import { PageHeader } from "@/components/ui-bits";
import { TransactionsList } from "./TransactionsList";

const RANGES = new Set(["month", "3m", "12m", "ytd", "all", "custom"]);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function TransactionsPage({
  searchParams,
}: {
  searchParams: Promise<{ m?: string; account?: string; range?: string; category?: string; focus?: string; from?: string; to?: string }>;
}) {
  const { householdId } = await requireHousehold();
  const { m, account, range: rangeParam, category, focus, from, to } = await searchParams;
  let range = RANGES.has(rangeParam ?? "") ? (rangeParam as string) : "month";
  // A valid from/to pair forces custom mode regardless of the range param.
  const hasCustom = ISO_DAY.test(from ?? "") && ISO_DAY.test(to ?? "") && (from as string) <= (to as string);
  if (range === "custom" && !hasCustom) range = "month";
  if (hasCustom) range = "custom";

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
    case "custom":
      startISO = from as string;
      endISO = to as string;
      rangeLabel = `${customLabel(startISO)} – ${customLabel(endISO)}`;
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

  // Validate comma-separated category/account filters from the URL, keeping
  // only ids that exist (plus the sentinel "uncategorized" / "no account").
  const catIds = new Set(categories.map((c) => c.id));
  const acctIds = new Set(accounts.map((a) => a.id));
  const initialCategoryId = (category ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((v) => v === "__uncategorized__" || catIds.has(v))
    .join(",");
  const initialAccountId = (account ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((v) => v === "__none__" || acctIds.has(v))
    .join(",");

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
        initialAccountId={initialAccountId}
        initialCategoryId={initialCategoryId}
        focusId={focus ?? ""}
        customFrom={range === "custom" ? startISO : ""}
        customTo={range === "custom" ? endISO : ""}
      />
    </div>
  );
}

function customLabel(iso: string): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
}
