import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { importAllData, type BackupPayload } from "@/lib/backup";

// Restore a full backup (produced by "Download backup" or the db:backup CLI)
// into this instance from the Settings UI. This is a destructive full replace:
// it truncates the tables present in the file and loads the file's rows verbatim,
// including the exported account's login and Plaid tokens. After it runs the
// caller's session points at a user that no longer exists, so the client signs
// out and the user logs back in with the credentials from the backup.
//
// Any signed-in user may trigger it - on a single-user self-host that's the
// owner, which is the whole point. The /api/backup prefix is already blocked in
// demo mode by proxy.ts.

export const dynamic = "force-dynamic";

// Guard against an accidental huge upload; a full backup is JSON text and even a
// large history is comfortably under this.
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const text = await req.text();
  if (text.length > MAX_BYTES) {
    return NextResponse.json({ error: "Backup file is too large." }, { status: 413 });
  }

  let payload: BackupPayload;
  try {
    payload = JSON.parse(text) as BackupPayload;
  } catch {
    return NextResponse.json({ error: "That file isn't valid JSON." }, { status: 400 });
  }

  if (payload?.app !== "moolah" || !Array.isArray(payload.tables)) {
    return NextResponse.json(
      { error: "That doesn't look like a Moolah backup file." },
      { status: 400 },
    );
  }

  try {
    const res = await importAllData(payload, undefined, { force: true });
    return NextResponse.json({ ok: true, imported: res.imported, tables: res.tables });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed." },
      { status: 500 },
    );
  }
}
