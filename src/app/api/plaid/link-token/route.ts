import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { plaidClient, PLAID_PRODUCTS, PLAID_COUNTRY_CODES } from "@/lib/plaid";

export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id } });
  if (!user?.householdId) return NextResponse.json({ error: "No household" }, { status: 403 });

  try {
    const response = await plaidClient.linkTokenCreate({
      user: { client_user_id: user.householdId },
      client_name: "Household Finance",
      products: PLAID_PRODUCTS,
      country_codes: PLAID_COUNTRY_CODES,
      language: "en",
    });
    return NextResponse.json({ link_token: response.data.link_token });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Plaid error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
