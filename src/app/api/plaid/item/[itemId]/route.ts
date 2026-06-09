// DELETE - disconnect a bank. Calls Plaid item/remove and cleans up local rows.
// Associated FinancialAccounts and their transactions are left intact so
// historical data is preserved; only the Plaid link is removed.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { plaidClient } from "@/lib/plaid";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.householdId) return NextResponse.json({ error: "No household" }, { status: 403 });

  const { itemId } = await params;
  const item = await prisma.plaidItem.findFirst({ where: { id: itemId, householdId: user.householdId } });
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  try {
    // Tell Plaid to revoke the access token.
    await plaidClient.itemRemove({ access_token: item.accessToken });
  } catch {
    // Non-fatal - the item may already be removed on Plaid's side.
  }

  // Remove the PlaidItem (cascades to PlaidLinkedAccount via FK).
  // The FinancialAccount and all transactions are intentionally kept.
  await prisma.plaidItem.delete({ where: { id: item.id } });

  return NextResponse.json({ ok: true });
}
