import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { isDemoMode } from "@/lib/demo-guard";
import { prisma } from "@/lib/prisma";

// GET /api/attachments/:id - stream the file inline, scoped to the session user.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;
  const att = await prisma.attachment.findFirst({ where: { id, userId } });
  if (!att) return NextResponse.json({ error: "Not found." }, { status: 404 });

  // filename lands inside a quoted header value; strip quotes/backslashes so
  // it can't break out of it, and drop anything outside printable ASCII since
  // header values must be ByteStrings. The RFC 5987 filename* param carries
  // the full unicode name for browsers that support it.
  const safeName = att.filename.replace(/["\\\r\n]/g, "").replace(/[^\x20-\x7E]/g, "_");
  const encodedName = encodeURIComponent(att.filename);
  return new NextResponse(new Uint8Array(att.data), {
    status: 200,
    headers: {
      "Content-Type": att.mimeType,
      "Content-Length": String(att.data.length),
      "Content-Disposition": `inline; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
      "X-Content-Type-Options": "nosniff",
      "Cache-Control": "private, max-age=3600",
    },
  });
}

// DELETE /api/attachments/:id - remove one attachment, scoped to the session user.
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (isDemoMode()) return NextResponse.json({ ok: true });
  const { id } = await params;
  const { count } = await prisma.attachment.deleteMany({ where: { id, userId } });
  if (count === 0) return NextResponse.json({ error: "Not found." }, { status: 404 });
  return NextResponse.json({ ok: true });
}
