import { requireHousehold } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getAccounts, getCategories } from "@/lib/queries";
import { AppChrome } from "@/components/AppChrome";
import { AutoPlaidSync } from "./AutoPlaidSync";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireHousehold();
  const [household, accounts, categories] = await Promise.all([
    prisma.household.findUnique({ where: { id: ctx.householdId }, select: { name: true } }),
    getAccounts(ctx.householdId),
    getCategories(ctx.householdId),
  ]);

  return (
    <AppChrome
      user={{ name: ctx.name, email: ctx.email, image: ctx.image }}
      householdName={household?.name ?? "Household"}
      accounts={accounts}
      categories={categories}
      authBypass={process.env.AUTH_BYPASS === "true"}
    >
      <AutoPlaidSync />
      {children}
    </AppChrome>
  );
}
