import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { compare } from "bcryptjs";
import { checkRateLimit } from "@/lib/rate-limit";
import { importAllData, type BackupPayload } from "@/lib/backup";

// Restore a full backup (produced by "Download backup" or the db:backup CLI)
// into this instance from the Settings UI. This is a destructive full replace:
// it truncates the tables present in the file and loads the file's rows verbatim,
// including the exported account's login and Plaid tokens. After it runs the
// caller's session points at a user that no longer exists, so the client signs
// out and the user logs back in with the credentials from the backup.
//
// Because it destroys everything in the instance, a valid session isn't enough:
// the caller re-enters their password here. A borrowed session (a shared
// machine, a stolen JWT) then can't wipe the database on its own.
//
// The /api/backup prefix is already blocked in demo mode by proxy.ts.

export const dynamic = "force-dynamic";

// Guard against an accidental huge upload; a full backup is JSON text and even a
// large history is comfortably under this.
const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

// Re-auth is a password check, so it gets the same online-guessing ceiling as
// sign-in, keyed per user.
const REAUTH_MAX_ATTEMPTS = 5;
const REAUTH_WINDOW_MS = 60_000;

// The shape importAllData is allowed to see. Rows stay open (columns vary by
// table and by schema version) but the envelope around them is pinned, so a
// malformed or hostile file is rejected before it reaches the loader.
const payloadSchema = z.object({
  app: z.literal("moolah"),
  version: z.literal(1),
  exportedAt: z.string(),
  tables: z
    .array(
      z.object({
        table: z.string().min(1),
        rows: z.array(z.record(z.string(), z.unknown())),
      }),
    )
    .min(1),
});

const bodySchema = z.object({
  password: z.string().min(1),
  payload: payloadSchema,
});

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Reject oversized uploads from the declared length before buffering the
  // body; the byte-size check after reading covers requests that lie about or
  // omit Content-Length.
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_BYTES) {
    return NextResponse.json({ error: "Backup file is too large." }, { status: 413 });
  }

  const text = await req.text();
  if (Buffer.byteLength(text, "utf8") > MAX_BYTES) {
    return NextResponse.json({ error: "Backup file is too large." }, { status: 413 });
  }

  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "That file isn't valid JSON." }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    const badPassword = parsed.error.issues.some((i) => i.path[0] === "password");
    return NextResponse.json(
      {
        error: badPassword
          ? "Enter your password to confirm."
          : "That doesn't look like a Moolah backup file.",
      },
      { status: 400 },
    );
  }

  if (!checkRateLimit(`backup-import:${userId}`, REAUTH_MAX_ATTEMPTS, REAUTH_WINDOW_MS).allowed) {
    return NextResponse.json(
      { error: "Too many attempts. Wait a minute and try again." },
      { status: 429 },
    );
  }

  // An account created under AUTH_BYPASS has no password to check against.
  // There's nothing to verify in that case, and bypass mode already lets any
  // visitor in, so re-auth can't add a guarantee it doesn't have.
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
  if (user?.passwordHash && !(await compare(parsed.data.password, user.passwordHash))) {
    return NextResponse.json({ error: "That password isn't right." }, { status: 403 });
  }

  try {
    const res = await importAllData(parsed.data.payload as BackupPayload, undefined, { force: true });
    return NextResponse.json({ ok: true, imported: res.imported, tables: res.tables });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Import failed." },
      { status: 500 },
    );
  }
}
