import { NextResponse } from "next/server";
import { householdForRoute } from "@/lib/household";
import { exportAllData, backupStamp } from "@/lib/backup";

// Backup download for the whole instance. Returns a single JSON file with every
// row of every table - including every member's login and the household's Plaid
// access tokens - so it can be restored on another machine without re-linking
// banks. The ledger is shared, and a partial dump would restore into a household
// missing members, so this is deliberately the full database rather than the
// caller's own rows. Admin-only for the same reason the credentials pages are:
// the file carries secrets for everyone in the household.
export async function GET() {
  const { ctx, response } = await householdForRoute();
  if (response) return response;
  if (!ctx.isAdmin) {
    return NextResponse.json({ error: "Only a household admin can export data." }, { status: 403 });
  }

  const payload = await exportAllData();
  const filename = `moolah-backup-${backupStamp(payload.exportedAt)}.json`;

  return new NextResponse(JSON.stringify(payload), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
