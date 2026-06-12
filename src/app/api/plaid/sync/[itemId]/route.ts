import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { syncPlaidItem } from "@/lib/plaid-sync";

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { itemId } = await params;

  // Ensure the item belongs to this user.
  const item = await prisma.plaidItem.findFirst({ where: { id: itemId, userId: session.user.id } });
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  try {
    const result = await syncPlaidItem(itemId);
    return NextResponse.json({ ok: true, ...result });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    console.error("Plaid sync error:", e);
    // Persist the error so the UI can surface it.
    await prisma.plaidItem.update({ where: { id: itemId }, data: { error: msg } });
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
