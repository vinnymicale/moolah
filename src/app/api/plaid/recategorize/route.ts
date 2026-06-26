import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/prisma";
import { plaidCategoryToName } from "@/lib/plaid-sync";

// POST /api/plaid/recategorize
// Re-applies the Plaid→category mapping to every uncategorized Plaid
// transaction using the stored plaidPrimaryCategory / plaidDetailedCategory
// fields. No Plaid API call is needed.
export async function POST() {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const userId = session.user.id;

  const categories = await prisma.category.findMany({ where: { userId } });
  const catByName = new Map(categories.map((c) => [c.name.toLowerCase(), c]));

  // All uncategorized transactions that have Plaid category data stored.
  const uncategorized = await prisma.transaction.findMany({
    where: {
      userId,
      deletedAt: null,
      categoryId: null,
      plaidPrimaryCategory: { not: null },
    },
    select: { id: true, plaidPrimaryCategory: true, plaidDetailedCategory: true },
  });

  let fixed = 0;
  for (const txn of uncategorized) {
    const catName = plaidCategoryToName(txn.plaidPrimaryCategory!, txn.plaidDetailedCategory ?? undefined);
    const category = catName ? catByName.get(catName.toLowerCase()) : null;
    if (!category) continue;

    await prisma.transaction.update({ where: { id: txn.id }, data: { categoryId: category.id } });
    fixed++;
  }

  return NextResponse.json({ ok: true, fixed, visited: uncategorized.length });
}
