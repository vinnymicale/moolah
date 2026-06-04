import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { plaidClient, PLAID_PRODUCTS, PLAID_COUNTRY_CODES } from "@/lib/plaid";

export async function POST(req: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.householdId) return NextResponse.json({ error: "No household" }, { status: 403 });

  // Optional: reconnect an existing item in Plaid update mode.
  const body = await req.json().catch(() => ({})) as { itemId?: string };

  try {
    let linkTokenParams: Parameters<typeof plaidClient.linkTokenCreate>[0];

    if (body.itemId) {
      // Update mode — re-authenticate an existing connection without creating a new item.
      const item = await prisma.plaidItem.findFirst({
        where: { id: body.itemId, householdId: user.householdId },
      });
      if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

      linkTokenParams = {
        user: { client_user_id: user.householdId },
        client_name: "Moolah",
        country_codes: PLAID_COUNTRY_CODES,
        language: "en",
        access_token: item.accessToken,
      };
    } else {
      // Fresh link — connect a new bank.
      linkTokenParams = {
        user: { client_user_id: user.householdId },
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
