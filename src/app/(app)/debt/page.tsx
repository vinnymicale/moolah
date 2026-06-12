import { requireUser } from "@/lib/session";
import { getAccounts } from "@/lib/queries";
import { LIABILITY_TYPES } from "@/lib/account-meta";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { DebtPlanner } from "./DebtPlanner";
import { DEMO_ACCOUNTS } from "@/lib/demo-data";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function DebtPage() {
  const accounts = DEMO_MODE ? DEMO_ACCOUNTS : await getAccounts((await requireUser()).userId);
  const debts = accounts.filter((a) => LIABILITY_TYPES.includes(a.type) && a.currentBalance > 0);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Debt payoff" subtitle="Plan your route to zero with avalanche or snowball." />
      {debts.length === 0 ? (
        <EmptyState
          title="No debts to plan"
          description="Add a credit card, loan, or other liability account with a balance to see a payoff timeline here."
          cta={{ href: "/accounts", label: "Manage accounts" }}
        />
      ) : (
        <DebtPlanner debts={debts} />
      )}
    </div>
  );
}
