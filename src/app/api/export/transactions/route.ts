import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// GET /api/export/transactions?from=YYYY-MM-DD&to=YYYY-MM-DD&account=ID&category=ID
// Streams the full (filtered) transaction history as a CSV download.
export async function GET(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = req.nextUrl.searchParams;
  const from = sp.get("from");
  const to = sp.get("to");
  const account = sp.get("account");
  const category = sp.get("category");

  const where: Record<string, unknown> = { userId, deletedAt: null };
  if (ISO_DAY.test(from ?? "") || ISO_DAY.test(to ?? "")) {
    const dateFilter: Record<string, Date> = {};
    if (ISO_DAY.test(from ?? "")) dateFilter.gte = new Date(`${from}T00:00:00.000Z`);
    if (ISO_DAY.test(to ?? "")) dateFilter.lte = new Date(`${to}T00:00:00.000Z`);
    where.date = dateFilter;
  }
  if (account) where.accountId = account;
  if (category === "__uncategorized__") where.categoryId = null;
  else if (category) where.categoryId = category;

  const [rows, accounts, categories] = await Promise.all([
    prisma.transaction.findMany({
      where,
      orderBy: { date: "desc" },
    }),
    prisma.financialAccount.findMany({ where: { userId }, select: { id: true, name: true } }),
    prisma.category.findMany({ where: { userId }, select: { id: true, name: true } }),
  ]);

  const acctName = new Map(accounts.map((a) => [a.id, a.name]));
  const catName = new Map(categories.map((c) => [c.id, c.name]));

  const header = ["Date", "Type", "Amount", "Description", "Category", "Account", "Cleared", "Note"];
  const lines = [header.join(",")];
  for (const t of rows) {
    lines.push([
      t.date.toISOString().slice(0, 10),
      t.type,
      String(toNumber(t.amount)),
      csv(t.description),
      csv(t.categoryId ? catName.get(t.categoryId) ?? "" : ""),
      csv(t.accountId ? acctName.get(t.accountId) ?? "" : ""),
      t.cleared ? "yes" : "no",
      csv(t.note ?? ""),
    ].join(","));
  }

  const body = lines.join("\n");
  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(body, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="transactions-${stamp}.csv"`,
    },
  });
}

function csv(s: string): string {
  // Neutralise spreadsheet formula injection (=, +, @, tab at cell start).
  let v = s;
  if (/^[=+@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}
