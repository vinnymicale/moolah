import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { exportAllData, backupStamp } from "@/lib/backup";

// Full-database backup download. Returns a single JSON file containing every
// table — including the Plaid access tokens — so it can be restored on another
// machine without re-linking banks. Gated behind a signed-in household member.
export async function GET() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.householdId) return NextResponse.json({ error: "No household" }, { status: 403 });

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
