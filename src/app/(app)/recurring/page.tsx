import { requireHousehold } from "@/lib/session";
import { getAccounts, getCategories, getRecurringRules } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { RecurringManager } from "./RecurringManager";

export default async function RecurringPage() {
  const { householdId } = await requireHousehold();
  const [rules, accounts, categories] = await Promise.all([
    getRecurringRules(householdId),
    getAccounts(householdId),
    getCategories(householdId),
  ]);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Recurring" subtitle="Paychecks, bills and subscriptions that repeat automatically on your calendar." />
      <RecurringManager rules={rules} accounts={accounts} categories={categories} />
    </div>
  );
}
