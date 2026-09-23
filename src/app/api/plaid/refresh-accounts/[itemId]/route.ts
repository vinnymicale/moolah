// Re-reads the accounts Plaid has authorized for an existing Item and creates
// FinancialAccounts for any that are new.
//
// This is what the "Add or remove accounts" flow calls once Link closes. The
// access token is unchanged by Account Select, so there is no public token to
// exchange - the new account shows up in /accounts/get instead. Plaid populates
// it asynchronously though, so we poll for the ids Link reported as selected
// rather than trusting a single read.

import { NextRequest, NextResponse } from "next/server";
import { householdForRoute } from "@/lib/household";
import { prisma } from "@/lib/prisma";
import { getPlaidClient } from "@/lib/plaid";
import { syncPlaidAccounts } from "@/lib/plaid-accounts";
import { syncPlaidItem } from "@/lib/plaid-sync";
import { decryptSecret } from "@/lib/crypto";

const ACCOUNT_POLL_ATTEMPTS = 3;
const ACCOUNT_POLL_INTERVAL_MS = 2000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Of the accounts Link said were selected, the ones we have not stored yet. */
async function missingAccountIds(plaidAccountIds: string[]): Promise<string[]> {
  if (plaidAccountIds.length === 0) return [];
  const linked = await prisma.plaidLinkedAccount.findMany({
    where: { plaidAccountId: { in: plaidAccountIds } },
    select: { plaidAccountId: true },
  });
  const stored = new Set(linked.map((l) => l.plaidAccountId));
  return plaidAccountIds.filter((id) => !stored.has(id));
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ itemId: string }> },
) {
  const { ctx, response } = await householdForRoute("MANAGE_ACCOUNTS");
  if (response) return response;

  const { itemId } = await params;
  const body = await req.json().catch(() => ({})) as { selectedAccountIds?: unknown };
  const selectedAccountIds = Array.isArray(body.selectedAccountIds)
    ? body.selectedAccountIds.filter((id): id is string => typeof id === "string")
    : [];

  // Ensure the item belongs to this household.
  const item = await prisma.plaidItem.findFirst({ where: { id: itemId, householdId: ctx.householdId } });
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  try {
    const plaidClient = await getPlaidClient(ctx.householdId);
    const accessToken = decryptSecret(item.accessToken);

    // Plaid fetches a newly selected account's data after Link closes, so the
    // first /accounts/get can still return the old list. When Link told us what
    // the user picked, give the slow ones a few seconds to show up before
    // concluding nothing was added.
    let result = await syncPlaidAccounts({
      plaidClient,
      accessToken,
      plaidItemRowId: item.id,
      householdId: ctx.householdId,
      institutionName: item.institutionName,
    });

    let missing = await missingAccountIds(selectedAccountIds);
    for (let attempt = 0; attempt < ACCOUNT_POLL_ATTEMPTS && missing.length > 0; attempt++) {
      await sleep(ACCOUNT_POLL_INTERVAL_MS);
      const retry = await syncPlaidAccounts({
        plaidClient,
        accessToken,
        plaidItemRowId: item.id,
        householdId: ctx.householdId,
        institutionName: item.institutionName,
      });
      result = { added: result.added + retry.added, updated: retry.updated };
      missing = await missingAccountIds(missing);
    }

    // Pull transactions so a newly added account isn't left empty.
    const syncResult = await syncPlaidItem(item.id, ctx.householdId);

    // syncResult.added counts transactions, result.added counts accounts - keep
    // them apart so the caller's "added N accounts" message stays truthful.
    return NextResponse.json({
      ok: true,
      added: result.added,
      updated: result.updated,
      missing: missing.length,
      transactions: syncResult,
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Failed to refresh accounts";
    console.error("Plaid refresh-accounts error:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
