// Re-reads the accounts Plaid has authorized for an existing Item and creates
// FinancialAccounts for any that are new.
//
// This is what the "Add or remove accounts" flow calls once Link closes. The
// access token is unchanged by Account Select, so there is no public token to
// exchange - the new account simply shows up in /accounts/get afterwards.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPlaidClient } from "@/lib/plaid";
import { syncPlaidAccounts } from "@/lib/plaid-accounts";
import { syncPlaidItem } from "@/lib/plaid-sync";
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
    const plaidClient = await getPlaidClient(session.user.id);
    const accessToken = decryptSecret(item.accessToken);

    const result = await syncPlaidAccounts({
      plaidClient,
      accessToken,
      plaidItemRowId: item.id,
      userId: session.user.id,
      institutionName: item.institutionName,
    });

    // Pull transactions so a newly added account isn't left empty.
    const syncResult = await syncPlaidItem(item.id, session.user.id);

    return NextResponse.json({ ok: true, ...result, ...syncResult });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to refresh accounts";
    console.error("Plaid refresh-accounts error:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
