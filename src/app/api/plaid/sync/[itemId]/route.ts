import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { syncPlaidItem } from "@/lib/plaid-sync";
import { syncPlaidAccounts } from "@/lib/plaid-accounts";
import { getPlaidClient } from "@/lib/plaid";
import { decryptSecret } from "@/lib/crypto";

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
    // Reconcile the account list first. syncPlaidItem only ever updates accounts
    // it already knows about, so on its own a reconnect can never surface an
    // account the user just authorized at the bank.
    const accounts = await syncPlaidAccounts({
      plaidClient: await getPlaidClient(session.user.id),
      accessToken: decryptSecret(item.accessToken),
      plaidItemRowId: item.id,
      userId: session.user.id,
      institutionName: item.institutionName,
    });

    const result = await syncPlaidItem(itemId, session.user.id);
    return NextResponse.json({ ok: true, ...result, accounts });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Sync failed";
    console.error("Plaid sync error:", e);
    // Persist the error so the UI can surface it.
    const updated = await prisma.plaidItem.update({
      where: { id: itemId },
      data: { error: msg, failureCount: { increment: 1 } },
    });
    try {
      const { runRules } = await import("@/lib/notifications/engine");
      await runRules(session.user.id, {
        mode: "event",
        event: {
          kind: "plaid-sync-failed",
          plaidItemId: itemId,
          reauthRequired: msg.includes("ITEM_LOGIN_REQUIRED"),
          failureCount: updated.failureCount,
          newTransactionIds: [],
        },
      });
    } catch (hookErr) {
      console.error("[notifications] sync-failure rules failed:", hookErr);
    }
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
