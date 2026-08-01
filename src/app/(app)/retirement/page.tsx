import { requireUser } from "@/lib/session";
import { getRetirementPageData } from "@/lib/queries/retirement";
import { getDemoUserId } from "@/lib/demo-session";
import { userTodayISO } from "@/lib/user-tz";
import { PageHeader, EmptyState } from "@/components/ui-bits";
import { SetupWizard } from "./SetupWizard";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function RetirementPage() {
  const userId = DEMO_MODE ? ((await getDemoUserId()) ?? "") : (await requireUser()).userId;
  const today = await userTodayISO();
  const data = await getRetirementPageData(userId, today);

  if (!data.hasAccounts) {
    return (
      <div className="mx-auto max-w-3xl">
        <PageHeader title="Retirement" subtitle="Plan for the long game." />
        <EmptyState
          title="No retirement or investment accounts yet"
          description="Add a retirement or investment account and it'll show up here, ready to plan against."
          cta={{ href: "/accounts", label: "Go to accounts" }}
        />
      </div>
    );
  }

  if (!data.hasPlan) {
    return <SetupWizard accounts={data.accounts} />;
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Retirement" subtitle="Plan for the long game." />
      <p className="text-sm text-muted">Projection panels land in the next task.</p>
    </div>
  );
}
