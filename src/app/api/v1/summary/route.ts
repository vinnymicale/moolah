// GET /api/v1/summary
// Headline figures for an external dashboard (Home Assistant et al.): net worth,
// safe-to-transfer, current-month budget status, and upcoming bills. Read-only,
// bearer-token auth. Optional ?tz=America/New_York to anchor "today"; defaults
// to UTC.

import { NextRequest } from "next/server";
import { requireApiUser, apiJson, readOnlyMethods } from "../_auth";
import { getNetWorth, getSafeToTransfer, getBudgetMonth } from "@/lib/queries";
import { getUpcoming } from "@/lib/calendar";
import { todayInZone } from "@/lib/user-tz";
import { sumMoney } from "@/lib/money";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;
  const { userId } = auth;

  const tz = req.nextUrl.searchParams.get("tz") ?? undefined;
  const todayISO = todayInZone(tz);
  const monthISO = `${todayISO.slice(0, 7)}-01`;

  const [netWorth, safe, budget, upcoming] = await Promise.all([
    getNetWorth(userId),
    getSafeToTransfer(userId, todayISO),
    getBudgetMonth(userId, monthISO),
    getUpcoming(userId, todayISO, 14),
  ]);

  const budgetTotal = sumMoney(budget.map((b) => b.limit));
  const budgetSpent = sumMoney(budget.map((b) => b.actual));

  return apiJson({
    asOf: todayISO,
    netWorth: { assets: netWorth.assets, liabilities: netWorth.liabilities, net: netWorth.net },
    safeToTransfer: safe.show ? safe.safeAmount : 0,
    budget: {
      month: monthISO,
      limit: budgetTotal,
      spent: budgetSpent,
      remaining: sumMoney([budgetTotal, -budgetSpent]),
    },
    upcoming: upcoming.map((u) => ({
      date: u.date,
      description: u.description,
      amount: u.amount,
      type: u.type,
      recurring: u.recurring,
    })),
  });
}

export const { POST, PUT, PATCH, DELETE } = readOnlyMethods;
