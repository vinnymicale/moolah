import { requireUser } from "@/lib/session";
import { getSavingsGoals } from "@/lib/queries";
import { PageHeader } from "@/components/ui-bits";
import { GoalsManager } from "./GoalsManager";
import { DEMO_GOALS } from "@/lib/demo-data";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function GoalsPage() {
  const goals = DEMO_MODE ? DEMO_GOALS : await getSavingsGoals((await requireUser()).userId);

  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title="Savings goals" subtitle="Set targets and track your progress toward them." />
      <GoalsManager goals={goals} />
    </div>
  );
}
