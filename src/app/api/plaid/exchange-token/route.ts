// Exchanges a Plaid public_token for a permanent access_token, creates the
// PlaidItem and PlaidLinkedAccount rows, auto-creates a matching
// FinancialAccount for each Plaid account, and kicks off the first sync.

import { NextRequest, NextResponse } from "next/server";
import { householdForRoute } from "@/lib/household";
import { prisma } from "@/lib/prisma";
import { getPlaidClient } from "@/lib/plaid";
import { syncPlaidItem } from "@/lib/plaid-sync";
import { syncPlaidAccounts } from "@/lib/plaid-accounts";
import { encryptSecret } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  const { ctx, response } = await householdForRoute();
  if (response) return response;

  const { public_token } = (await req.json()) as { public_token: string };
  if (!public_token) return NextResponse.json({ error: "Missing public_token" }, { status: 400 });

  try {
    const plaidClient = await getPlaidClient(ctx.householdId);

    // Exchange the short-lived public token for a permanent access token.
    const exchangeRes = await plaidClient.itemPublicTokenExchange({ public_token });
    const { access_token, item_id } = exchangeRes.data;

    // Fetch institution info.
    const itemRes = await plaidClient.itemGet({ access_token });
    const institutionId = itemRes.data.item.institution_id ?? null;
    let institutionName: string | null = null;
    if (institutionId) {
      try {
        const instRes = await plaidClient.institutionsGetById({ institution_id: institutionId, country_codes: ["US" as never] });
        institutionName = instRes.data.institution.name;
      } catch {
        // Non-fatal - institution name is cosmetic.
      }
    }

    // Upsert the PlaidItem - update mode re-links return the same item_id.
    const plaidItem = await prisma.plaidItem.upsert({
      where: { itemId: item_id },
      create: {
        householdId: ctx.householdId,
        accessToken: encryptSecret(access_token),
        itemId: item_id,
        institutionId,
        institutionName,
      },
      update: {
        accessToken: encryptSecret(access_token),
        institutionId,
        institutionName,
        error: null,
      },
    });

    await syncPlaidAccounts({
      plaidClient,
      accessToken: access_token,
      plaidItemRowId: plaidItem.id,
      householdId: ctx.householdId,
      institutionName,
    });

    // First sync - pull all available transactions.
    const syncResult = await syncPlaidItem(plaidItem.id, ctx.householdId);

    return NextResponse.json({ ok: true, institutionName, ...syncResult });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Plaid error";
    console.error("Plaid exchange-token error:", e);
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
