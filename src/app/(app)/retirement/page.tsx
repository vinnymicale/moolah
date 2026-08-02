import { requireUser } from "@/lib/session";
import { getRetirementPageData } from "@/lib/queries/retirement";
import { getDemoUserId } from "@/lib/demo-session";
import { userTodayISO } from "@/lib/user-tz";
import { PageHeader, EmptyState, StatCard } from "@/components/ui-bits";
import { formatUSDWhole } from "@/lib/money";
import { SetupWizard } from "./SetupWizard";
import { VerdictHeader, RequiredSavingsPanel } from "./VerdictHeader";
import { ProjectionChart } from "./ProjectionChart";
import { ContributionLimits } from "./ContributionLimits";
import { GrowthAttribution } from "./GrowthAttribution";
import { DrawdownPanel } from "./DrawdownPanel";
import { ContributionLog } from "./ContributionLog";
import { AssumptionsPanel } from "./AssumptionsPanel";

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
    <div className="stagger mx-auto max-w-5xl">
      <PageHeader title="Retirement" subtitle="Plan for the long game." />

      <VerdictHeader
        projection={data.projection!}
        target={data.target!}
        requiredSavings={data.requiredSavings!}
      />

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Retirement balance" value={formatUSDWhole(data.totalBalance)} />
        <StatCard
          label={`Projected at ${data.assumptions!.targetRetirementAge}`}
          value={formatUSDWhole(data.projection!.finalBalance)}
          hint="In today's dollars"
        />
        <StatCard label="Target" value={formatUSDWhole(data.target!.target)} />
        <StatCard
          label="Monthly contribution"
          value={formatUSDWhole(
            data.currentMonthlyContribution + data.currentMonthlyEmployerMatch,
          )}
          hint={
            data.currentMonthlyEmployerMatch > 0
              ? `${formatUSDWhole(data.currentMonthlyContribution)} yours + ${formatUSDWhole(data.currentMonthlyEmployerMatch)} match`
              : undefined
          }
          info="Employer match is included once a match formula is set, and counts toward the projection."
        />
      </div>

      <ProjectionChart
        points={data.projection!.points}
        coastPoints={data.coastProjection!.points}
        target={data.target!.target}
      />

      <RequiredSavingsPanel
        requiredSavings={data.requiredSavings!}
        employerMatchMonthly={data.currentMonthlyEmployerMatch}
      />
      <ContributionLimits
        limits={data.limits!}
        accounts={data.accounts}
        ytdContributions={data.ytdContributions}
      />
      {data.growth && <GrowthAttribution growth={data.growth} />}
      <DrawdownPanel drawdown={data.drawdown!} />
      <ContributionLog
        accounts={data.accounts}
        recentContributions={data.recentContributions}
        currentMonthlyContribution={data.currentMonthlyContribution}
        limitsUseYtdOverride={data.limits!.usesYtdOverride}
        taxYear={data.currentTaxYear}
      />
      <AssumptionsPanel
        assumptions={data.assumptions!}
        accounts={data.accounts}
        employerMatch={data.employerMatch}
      />
    </div>
  );
}
