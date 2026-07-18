import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/session";
import { isDemoMode } from "@/lib/demo-guard";
import { prisma } from "@/lib/prisma";
import { validateAttachmentUpload } from "@/lib/attachments";

// POST /api/attachments - multipart form { transactionId, file }.
// A route handler rather than a server action: uploads can exceed the 1MB
// server-action body cap, and downloads need a GET sibling anyway.
export async function POST(req: NextRequest) {
  let userId: string;
  try {
    ({ userId } = await requireUser());
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const form = await req.formData();
  const transactionId = form.get("transactionId");
  const file = form.get("file");
  if (typeof transactionId !== "string" || !transactionId || !(file instanceof File)) {
    return NextResponse.json({ error: "Missing transactionId or file." }, { status: 400 });
  }

  if (isDemoMode()) {
    return NextResponse.json(
      { id: `demo-${Date.now()}`, filename: file.name || "attachment", mimeType: file.type, size: file.size },
      { status: 201 },
    );
  }

  const txn = await prisma.transaction.findFirst({
    where: { id: transactionId, userId },
    select: { id: true, _count: { select: { attachments: true } } },
  });
  if (!txn) return NextResponse.json({ error: "Transaction not found." }, { status: 404 });

  const invalid = validateAttachmentUpload({
    mimeType: file.type,
    size: file.size,
    existingCount: txn._count.attachments,
  });
  if (invalid) return NextResponse.json({ error: invalid }, { status: 400 });

  const bytes = Buffer.from(await file.arrayBuffer());
  const created = await prisma.attachment.create({
    data: {
      userId,
      transactionId,
      filename: file.name || "attachment",
      mimeType: file.type,
      size: bytes.length,
      data: bytes,
    },
    select: { id: true, filename: true, mimeType: true, size: true },
  });
  return NextResponse.json(created, { status: 201 });
}
