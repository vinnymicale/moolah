import { requireUser } from "@/lib/session";
import { getAccounts, getCategories, getRecurringRules, getRecurringSuggestions } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { RecurringManager } from "./RecurringManager";
import { DEMO_ACCOUNTS, DEMO_CATEGORIES, DEMO_RECURRING, DEMO_SUGGESTIONS } from "@/lib/demo-data";
import { userTodayISO } from "@/lib/user-tz";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function RecurringPage() {
  if (DEMO_MODE) {
    return (
      <div className="stagger mx-auto max-w-3xl">
        <PageHeader title="Recurring" subtitle="Paychecks, bills and subscriptions that repeat automatically on your calendar." />
        <RecurringManager rules={DEMO_RECURRING} accounts={DEMO_ACCOUNTS} categories={DEMO_CATEGORIES} suggestions={DEMO_SUGGESTIONS} />
      </div>
    );
  }

  const { userId } = await requireUser();
  const [rules, accounts, categories, suggestions] = await Promise.all([
    getRecurringRules(userId),
    getAccounts(userId),
    getCategories(userId),
    getRecurringSuggestions(userId, await userTodayISO()),
  ]);

  return (
    <div className="stagger mx-auto max-w-3xl">
      <PageHeader title="Recurring" subtitle="Paychecks, bills and subscriptions that repeat automatically on your calendar." />
      <RecurringManager rules={rules} accounts={accounts} categories={categories} suggestions={suggestions} />
    </div>
  );
}
