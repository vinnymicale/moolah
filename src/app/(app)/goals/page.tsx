import { requireHousehold } from "@/lib/session";
import { getSavingsGoals } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { GoalsManager } from "./GoalsManager";

export default async function GoalsPage() {
  const { householdId } = await requireHousehold();
  const goals = await getSavingsGoals(householdId);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Savings goals" subtitle="Set targets and track your progress toward them." />
      <GoalsManager goals={goals} />
    </div>
  );
}
