import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { getPlaidClient, PLAID_PRODUCTS, PLAID_COUNTRY_CODES } from "@/lib/plaid";
import { decryptSecret } from "@/lib/crypto";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Optional: reconnect an existing item in Plaid update mode.
  const body = await req.json().catch(() => ({})) as { itemId?: string; accountSelection?: boolean };

  try {
    const plaidClient = await getPlaidClient(session.user.id);
    let linkTokenParams: Parameters<typeof plaidClient.linkTokenCreate>[0];

    if (body.itemId) {
      // Update mode - re-authenticate an existing connection without creating a new item.
      const item = await prisma.plaidItem.findFirst({
        where: { id: body.itemId, userId: session.user.id },
      });
      if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

      linkTokenParams = {
        user: { client_user_id: session.user.id },
        client_name: "Moolah",
        country_codes: PLAID_COUNTRY_CODES,
        language: "en",
        access_token: decryptSecret(item.accessToken),
        // Account Select re-opens the institution's account picker with the
        // current selections checked, which is the only way to authorize an
        // account that was left out when the bank was first linked. Most OAuth
        // institutions force it on regardless; the flag covers the rest.
        ...(body.accountSelection ? { update: { account_selection_enabled: true } } : {}),
      };
    } else {
      // Fresh link - connect a new bank.
      linkTokenParams = {
        user: { client_user_id: session.user.id },
        client_name: "Moolah",
        products: PLAID_PRODUCTS,
        country_codes: PLAID_COUNTRY_CODES,
        language: "en",
      };
    }

    const response = await plaidClient.linkTokenCreate(linkTokenParams);
    return NextResponse.json({ link_token: response.data.link_token });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Plaid error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
