import { requireUser } from "@/lib/session";
import { prisma } from "@/lib/prisma";
import { getHouseholdContext } from "@/lib/household";
import { redirect } from "next/navigation";
import { getAccounts, getCategories } from "@/lib/queries";
import { getUnreadNotificationCount } from "@/lib/queries/notifications";
import { AppChrome } from "@/components/AppChrome";
import { allowedNavHrefs } from "@/components/app-nav";
import { AutoPlaidSync } from "./AutoPlaidSync";
import { DemoStoreProvider } from "@/components/DemoStore";
import { DEMO_EMAIL, DEMO_NAME } from "@/lib/demo-session";
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
          user={{ name: DEMO_NAME, email: DEMO_EMAIL, image: null }}
          accounts={DEMO_ACCOUNTS}
          categories={DEMO_CATEGORIES}
          authBypass
          demoMode
          canSync
        >
          {children}
        </AppChrome>
      </DemoStoreProvider>
    );
  }

  const user = await requireUser();
  // The chrome needs both ids: accounts and categories come from the shared
  // household ledger, while the notification count is the user's own.
  const [household, account] = await Promise.all([
    getHouseholdContext(user.userId),
    prisma.user.findUnique({
      where: { id: user.userId },
      select: { mustChangePassword: true },
    }),
  ]);
  // An admin-created account keeps the password its admin chose until it picks
  // its own, so nothing in the app is reachable on a shared secret.
  if (account?.mustChangePassword) redirect("/change-password");
  if (!household) redirect("/no-household");
  const [accounts, categories, unreadCount] = await Promise.all([
    getAccounts(household.householdId),
    getCategories(household.householdId),
    getUnreadNotificationCount(user.userId),
  ]);

  return (
    <AppChrome
      user={{ name: user.name, email: user.email, image: user.image }}
      allowedHrefs={allowedNavHrefs(household.can, household.isAdmin)}
      accounts={accounts}
      categories={categories}
      authBypass={process.env.AUTH_BYPASS === "true"}
      unreadCount={unreadCount}
      canSync={household.can("RUN_SYNC")}
      canUseChat={household.can("USE_CHAT")}
    >
      {household.can("RUN_SYNC") && <AutoPlaidSync />}
      {children}
    </AppChrome>
  );
}
