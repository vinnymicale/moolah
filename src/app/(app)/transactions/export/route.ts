// CSV export for the transactions list. Takes the same query params as the
// /transactions page (range + filters) and streams every matching row, not
// just the page the client happens to have loaded.

import type { NextRequest } from "next/server";
import { requireUser } from "@/lib/session";
import { getAccounts, getCategories, getTransactionsBetween, type TransactionDTO } from "@/lib/queries";
import { userTodayISO } from "@/lib/user-tz";
import { resolveTransactionsRange } from "../resolve-range";
import { csvField, filterTransactionDTOs, parseTransactionFilters } from "../transactions-utils";
import { DEMO_ACCOUNTS, DEMO_CATEGORIES, DEMO_TRANSACTIONS } from "@/lib/demo-data";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export async function GET(req: NextRequest) {
  const params = Object.fromEntries(req.nextUrl.searchParams) as Record<string, string>;
  const userId = DEMO_MODE ? "" : (await requireUser()).userId;
  const todayISO = await userTodayISO();
  const { startISO, endISO, slug } = resolveTransactionsRange(params, todayISO);
  const filters = parseTransactionFilters(params);

  const [accounts, categories] = DEMO_MODE
    ? [DEMO_ACCOUNTS, DEMO_CATEGORIES]
    : await Promise.all([getAccounts(userId), getCategories(userId)]);
  const catById = new Map(categories.map((c) => [c.id, c.name]));
  const acctById = new Map(accounts.map((a) => [a.id, a.name]));

  let transactions: TransactionDTO[];
  if (DEMO_MODE) {
    const inRange = DEMO_TRANSACTIONS.filter((t) => t.date >= startISO && t.date <= endISO);
    transactions = filterTransactionDTOs(inRange, filters, catById);
  } else {
    transactions = await getTransactionsBetween(userId, startISO, endISO, filters);
  }

  const header = ["Date", "Type", "Amount", "Description", "Category", "Account", "Cleared", "Note"];
  const rows = transactions.map((t) => [
    t.date,
    t.type,
    String(t.amount),
    csvField(t.description),
    csvField(t.categoryId ? catById.get(t.categoryId) ?? "" : ""),
    csvField(t.accountId ? acctById.get(t.accountId) ?? "" : ""),
    t.cleared ? "yes" : "no",
    csvField(t.note ?? ""),
  ]);
  const content = [header, ...rows].map((r) => r.join(",")).join("\n");

  return new Response(content, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${slug}.csv"`,
    },
  });
}
