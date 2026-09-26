import { requirePageCapability } from "@/lib/household";
import { EmptyState, PageHeader } from "@/components/ui-bits";
import { getRewardCards, toRankInputs, type RewardCardDTO, type RewardProfileDTO } from "@/lib/queries/card-rewards";
import type { CapProgressDTO } from "@/lib/card-rewards/rank";
import { DEMO_CAP_PROGRESS, DEMO_REWARD_CARDS } from "@/lib/demo-data";
import { AccountsTabs } from "../AccountsTabs";
import { BestCardTable } from "./BestCardTable";
import { CardRewardsPanel } from "./CardRewardsPanel";
import { SetupRewards } from "./SetupRewards";

const DEMO_MODE = process.env.DEMO_MODE === "true";

export default async function CardRewardsPage() {
  if (DEMO_MODE) {
    return <RewardsView cards={DEMO_REWARD_CARDS} progress={DEMO_CAP_PROGRESS} canManage />;
  }
  const { householdId, can } = await requirePageCapability("VIEW_ACCOUNTS");
  const { cards, progress } = await getRewardCards(householdId);
  return <RewardsView cards={cards} progress={progress} canManage={can("MANAGE_ACCOUNTS")} />;
}

function RewardsView({
  cards,
  progress,
  canManage,
}: {
  cards: RewardCardDTO[];
  progress: CapProgressDTO[];
  canManage: boolean;
}) {
  const today = new Date().toISOString();
  const withProfile = cards.filter((c): c is RewardCardDTO & { profile: RewardProfileDTO } => c.profile !== null);

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeader title="Accounts & Net Worth" subtitle="Which card to swipe, category by category." />
      <AccountsTabs active="rewards" />

      {cards.length === 0 ? (
        <EmptyState
          title="No credit cards yet"
          description="Add a credit card account and its rewards will show up here."
          cta={{ href: "/accounts", label: "Go to accounts" }}
        />
      ) : (
        <>
          {withProfile.length > 0 && (
            <BestCardTable profiles={toRankInputs(withProfile)} progress={progress} today={today} />
          )}
          <h2 className="mb-3 font-display text-lg font-semibold">Your cards</h2>
          <div className="space-y-4">
            {cards.map((card) =>
              card.profile ? (
                <CardRewardsPanel
                  key={card.accountId}
                  card={card as RewardCardDTO & { profile: RewardProfileDTO }}
                  progress={progress}
                  today={today}
                  canManage={canManage}
                />
              ) : canManage ? (
                <SetupRewards key={card.accountId} card={card} />
              ) : (
                <section key={card.accountId} className="card p-4 text-sm text-muted">
                  {card.name}: no rewards set up yet.
                </section>
              ),
            )}
          </div>
        </>
      )}
    </div>
  );
}
