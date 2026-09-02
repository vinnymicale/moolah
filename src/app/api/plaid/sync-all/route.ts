import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { changedCount, sweepPlaid } from "@/lib/plaid-sweep";

/**
 * Syncs every linked bank for the signed-in user that is "stale" (never
 * synced, or last synced outside the staleness window). Best-effort: one item
 * failing doesn't stop the others. Called in the background from the app on
 * load - see AutoPlaidSync - which on a long-lived server is mostly a catch-up
 * for time the process was down, since the background scheduler
 * (src/lib/plaid-scheduler.ts) keeps things current. Pass ?force=1 to sync
 * every bank regardless of staleness (the manual sync button - see SyncButton).
 */
export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const force = new URL(req.url).searchParams.get("force") === "1";
  const totals = await sweepPlaid({ userId: session.user.id, force });

  return NextResponse.json({ ok: true, ...totals, changed: changedCount(totals) });
}
