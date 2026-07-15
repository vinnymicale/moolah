import type { TransactionDTO, TransactionFilters, TransactionsPageDTO } from "@/lib/queries";

export type TxnTypeOpt = "INCOME" | "EXPENSE";
export type StatusOpt = "CLEARED" | "PENDING";

// Page size mirrored from queries.ts (not imported: queries.ts pulls in
// Prisma, and this module is shared with client components).
export const PAGE_SIZE = 100;

const TXN_TYPES = new Set<string>(["INCOME", "EXPENSE"]);
const STATUSES = new Set<string>(["CLEARED", "PENDING"]);

/** Parse the transactions list's filter query params into server-side filters. */
export function parseTransactionFilters(params: {
  q?: string;
  type?: string;
  status?: string;
  category?: string;
  account?: string;
  tag?: string;
}): TransactionFilters {
  return {
    search: (params.q ?? "").trim(),
    types: [...toSet(params.type ?? "")].filter((v) => TXN_TYPES.has(v)) as TransactionFilters["types"],
    statuses: [...toSet(params.status ?? "")].filter((v) => STATUSES.has(v)) as TransactionFilters["statuses"],
    categoryIds: [...toSet(params.category ?? "")],
    accountIds: [...toSet(params.account ?? "")],
    tagIds: [...toSet(params.tag ?? "")],
  };
}

/**
 * In-memory version of the DB filtering in getTransactionsPage, used for demo
 * mode and CSV export of demo data. Matching semantics mirror the Prisma
 * where-clause: case-insensitive contains on description/note/category name.
 */
export function filterTransactionDTOs(
  list: TransactionDTO[],
  f: TransactionFilters,
  categoryNameById: Map<string, string>,
): TransactionDTO[] {
  const q = f.search.toLowerCase();
  return list.filter((t) => {
    if (f.types.length > 0 && !f.types.includes(t.type)) return false;
    if (f.statuses.length === 1 && (f.statuses[0] === "CLEARED") !== t.cleared) return false;
    if (f.categoryIds.length > 0 && !f.categoryIds.includes(t.categoryId ?? "__uncategorized__")) return false;
    if (f.accountIds.length > 0 && !f.accountIds.includes(t.accountId ?? "__none__")) return false;
    if (f.tagIds.length > 0 && !t.tags.some((x) => f.tagIds.includes(x.id))) return false;
    if (q) {
      const cat = t.categoryId ? categoryNameById.get(t.categoryId) ?? "" : "";
      if (
        !t.description.toLowerCase().includes(q) &&
        !(t.note ?? "").toLowerCase().includes(q) &&
        !cat.toLowerCase().includes(q)
      ) {
        return false;
      }
    }
    return true;
  });
}

/** In-memory version of getTransactionsPage's paging + totals, for demo mode. */
export function paginateTransactionDTOs(filtered: TransactionDTO[], page: number): TransactionsPageDTO {
  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(Math.max(1, page), pageCount);
  return {
    items: filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE),
    total: filtered.length,
    page: safePage,
    pageCount,
    income: filtered.filter((t) => t.type === "INCOME" && !t.effectiveTransfer).reduce((s, t) => s + t.amount, 0),
    expense: filtered.filter((t) => t.type === "EXPENSE" && !t.effectiveTransfer).reduce((s, t) => s + t.amount, 0),
  };
}

export interface SavedFilter {
  name: string;
  search: string;
  types: TxnTypeOpt[];
  statuses: StatusOpt[];
  cats: string[];
  accts: string[];
  tags: string[];
}

/** Split a comma-separated query value into a Set of non-empty tokens. */
export function toSet(csv: string): Set<string> {
  return new Set(csv.split(",").map((s) => s.trim()).filter(Boolean));
}

/** Quote a CSV field if it contains a comma, quote, or newline. */
export function csvField(s: string): string {
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

/** Last day-of-month (zero-padded) for an ISO month like "2026-06-01". */
export function endOfMonthDay(monthISO: string): string {
  const [y, m] = monthISO.slice(0, 7).split("-").map(Number);
  return String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0");
}
