import { requireHousehold } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getAccounts, getCategories } from "@/lib/queries";
import { AppChrome } from "@/components/AppChrome";
import { AutoPlaidSync } from "./AutoPlaidSync";
import { DemoStoreProvider } from "@/components/DemoStore";
import {
  DEMO_ACCOUNTS, DEMO_CATEGORIES, DEMO_TRANSACTIONS, DEMO_RECURRING,
  DEMO_BUDGETS, DEMO_GOALS, DEMO_SUGGESTIONS, buildDemoSnapshots,
} from "@/lib/demo-data";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  if (DEMO_MODE) {
    return (
      <DemoStoreProvider
        initialData={{
          accounts: DEMO_ACCOUNTS,
          categories: DEMO_CATEGORIES,
          transactions: DEMO_TRANSACTIONS,
          recurring: DEMO_RECURRING,
          budgets: DEMO_BUDGETS,
          goals: DEMO_GOALS,
          snapshots: buildDemoSnapshots(),
          suggestions: DEMO_SUGGESTIONS,
        }}
      >
        <AppChrome
          user={{ name: "Demo User", email: "demo@example.com", image: null }}
          householdName="Our Household"
          accounts={DEMO_ACCOUNTS}
          categories={DEMO_CATEGORIES}
          authBypass
          demoMode
        >
          {children}
        </AppChrome>
      </DemoStoreProvider>
    );
  }

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
