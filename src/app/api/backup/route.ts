import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { exportAllData, backupStamp } from "@/lib/backup";

// Full-database backup download. Returns a single JSON file containing every
// table - including the Plaid access tokens - so it can be restored on another
// machine without re-linking banks. Because the dump is database-wide, it is
// only allowed when the requester is the sole user in the database (the
// self-host case); otherwise it would expose other users' data.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const otherUsers = await prisma.user.count({ where: { id: { not: session.user.id } } });
  if (otherUsers > 0) {
    return NextResponse.json(
      { error: "Backup download is only available on single-user installations. Use the db:backup CLI script on the server instead." },
      { status: 403 },
    );
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
