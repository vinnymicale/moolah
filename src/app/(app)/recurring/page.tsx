import { requireHousehold } from "@/lib/session";
import { getAccounts, getCategories, getRecurringRules, getRecurringSuggestions } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { RecurringManager } from "./RecurringManager";

function localTodayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export default async function RecurringPage() {
  const { householdId } = await requireHousehold();
  const [rules, accounts, categories, suggestions] = await Promise.all([
    getRecurringRules(householdId),
    getAccounts(householdId),
    getCategories(householdId),
    getRecurringSuggestions(householdId, localTodayISO()),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Recurring" subtitle="Paychecks, bills and subscriptions that repeat automatically on your calendar." />
      <RecurringManager rules={rules} accounts={accounts} categories={categories} suggestions={suggestions} />
    </div>
  );
}
