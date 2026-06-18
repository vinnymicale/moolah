// GET /api/v1/net-worth — assets, liabilities, net, and per-account balances.
//
// Optional query params:
//   ?range=3m|1y|all   include a daily history series (carry-forward snapshots).
//   ?forecast=12       include a monthly net-worth projection N months forward
//                      (1-24). Omit for the current snapshot only.
//   ?tz=America/...    anchor "today" for the history/forecast windows.

import { NextRequest } from "next/server";
import { requireApiUser, apiJson, readOnlyMethods } from "../_auth";
import { getNetWorth } from "@/lib/queries";
import { getNetWorthHistory } from "@/lib/snapshots";
import { forecastNetWorth } from "@/lib/networth-forecast";
import { todayInZone } from "@/lib/user-tz";

export const dynamic = "force-dynamic";

const RANGE_DAYS: Record<string, number> = { "3m": 90, "1y": 366, all: 3660 };

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const todayISO = todayInZone(sp.get("tz") ?? undefined);

  const nw = await getNetWorth(auth.userId);
  const body: Record<string, unknown> = {
    asOf: todayISO,
    assets: nw.assets,
    liabilities: nw.liabilities,
    net: nw.net,
    accounts: nw.accounts.map((a) => ({
      id: a.id,
      name: a.name,
      type: a.type,
      balance: a.currentBalance,
      isAsset: a.isAsset,
      includeInNetWorth: a.includeInNetWorth,
    })),
  };

  const rangeKey = sp.get("range")?.toLowerCase();
  if (rangeKey && rangeKey in RANGE_DAYS) {
    body.history = await getNetWorthHistory(auth.userId, RANGE_DAYS[rangeKey], todayISO);
  }

  const forecastRaw = Number(sp.get("forecast"));
  if (Number.isFinite(forecastRaw) && forecastRaw > 0) {
    const months = Math.min(24, Math.trunc(forecastRaw));
    body.forecast = await forecastNetWorth(auth.userId, nw.net, months, todayISO);
  }

  return apiJson(body);
}

export const { POST, PUT, PATCH, DELETE } = readOnlyMethods;
