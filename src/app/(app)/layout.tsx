import { requireUser } from "@/lib/session";
import { getAccounts, getCategories } from "@/lib/queries";
import { getUnreadNotificationCount } from "@/lib/queries/notifications";
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

  const ctx = await requireUser();
  const [accounts, categories, unreadCount] = await Promise.all([
    getAccounts(ctx.userId),
    getCategories(ctx.userId),
    getUnreadNotificationCount(ctx.userId),
  ]);

  return (
    <AppChrome
      user={{ name: ctx.name, email: ctx.email, image: ctx.image }}
      accounts={accounts}
      categories={categories}
      authBypass={process.env.AUTH_BYPASS === "true"}
      unreadCount={unreadCount}
    >
      <AutoPlaidSync />
      {children}
    </AppChrome>
  );
}
