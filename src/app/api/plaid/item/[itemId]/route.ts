// DELETE - disconnect a bank. Calls Plaid item/remove and cleans up local rows.
// Associated FinancialAccounts and their transactions are left intact so
// historical data is preserved; only the Plaid link is removed.

import { NextRequest, NextResponse } from "next/server";
import { householdForRoute } from "@/lib/household";
import { prisma } from "@/lib/prisma";
import { getPlaidClient } from "@/lib/plaid";
import { decryptSecret } from "@/lib/crypto";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { ctx, response } = await householdForRoute("MANAGE_ACCOUNTS");
  if (response) return response;

  const { itemId } = await params;
  const item = await prisma.plaidItem.findFirst({ where: { id: itemId, householdId: ctx.householdId } });
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  try {
    // Tell Plaid to revoke the access token.
    const plaidClient = await getPlaidClient(ctx.householdId);
    await plaidClient.itemRemove({ access_token: decryptSecret(item.accessToken) });
  } catch {
    // Non-fatal - the item may already be removed on Plaid's side.
  }

  // Remove the PlaidItem (cascades to PlaidLinkedAccount via FK).
  // The FinancialAccount and all transactions are intentionally kept.
  await prisma.plaidItem.delete({ where: { id: item.id } });

  return NextResponse.json({ ok: true });
}
