// GET /api/v1/upcoming — bills and income expected in the next N days.
// Optional ?days=14 (1-90) and ?tz= to anchor "today".

import { NextRequest } from "next/server";
import { requireApiUser, apiJson } from "../_auth";
import { getUpcoming } from "@/lib/calendar";
import { todayInZone } from "@/lib/user-tz";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireApiUser(req);
  if (!auth.ok) return auth.response;

  const sp = req.nextUrl.searchParams;
  const daysRaw = Number(sp.get("days"));
  const days = Number.isFinite(daysRaw) ? Math.min(90, Math.max(1, Math.trunc(daysRaw))) : 14;
  const todayISO = todayInZone(sp.get("tz") ?? undefined);

  const items = await getUpcoming(auth.userId, todayISO, days);
  return apiJson({
    asOf: todayISO,
    days,
    items: items.map((u) => ({
      date: u.date,
      description: u.description,
      amount: u.amount,
      type: u.type,
      recurring: u.recurring,
    })),
  });
}
