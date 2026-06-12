import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { exportUserData, backupStamp } from "@/lib/backup";

// Backup download for the signed-in user. Returns a single JSON file with all
// of their rows - including their Plaid access tokens - so it can be restored
// on another machine without re-linking banks. Scoped to the requesting user,
// so other local accounts (and the seeded demo user) are never included. For a
// whole-database dump, use the db:backup CLI script on the server.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const payload = await exportUserData(session.user.id);
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
