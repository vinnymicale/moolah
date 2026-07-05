// GET /api/v1/budget — current-month budget vs. actual per category.
// Optional ?month=YYYY-MM and ?tz= to anchor the month; defaults to this month
// in UTC.

import { NextRequest } from "next/server";
import { requireApiUser, apiJson, readOnlyMethods } from "../_auth";
import { getBudgetMonth } from "@/lib/queries";
import { todayInZone } from "@/lib/user-tz";
import { sumMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

const MONTH = /^\d{4}-\d{2}$/;

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const monthParam = sp.get("month");
  const month = MONTH.test(monthParam ?? "")
    ? `${monthParam}-01`
    : `${todayInZone(sp.get("tz") ?? undefined).slice(0, 7)}-01`;

  const lines = await getBudgetMonth(auth.userId, month);
  const limit = sumMoney(lines.map((b) => b.limit));
  const effectiveLimit = sumMoney(lines.map((b) => b.effectiveLimit));
  const spent = sumMoney(lines.map((b) => b.actual));

  return apiJson({
    month,
    total: { limit, effectiveLimit, spent, remaining: sumMoney([effectiveLimit, -spent]) },
    categories: lines.map((b) => ({
      categoryId: b.categoryId,
      name: b.name,
      limit: b.limit,
      rollover: b.rollover,
      carryover: b.carryover,
      effectiveLimit: b.effectiveLimit,
      spent: b.actual,
      remaining: sumMoney([b.effectiveLimit, -b.actual]),
    })),
  });
}

export const { POST, PUT, PATCH, DELETE } = readOnlyMethods;
