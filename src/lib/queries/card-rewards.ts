import { prisma } from "@/lib/prisma";
import { toNumber } from "@/lib/money";
import { isoDay, periodStart, type CapProgressDTO, type RankInputProfile } from "@/lib/card-rewards/rank";
import { parseRotating, parseRules, type RewardCurrency, type RewardRule, type RotatingProgram } from "@/lib/card-rewards/types";

export interface RewardProfileDTO {
  id: string;
  catalogCardId: string | null;
  currency: RewardCurrency;
  programName: string | null;
  centsPerPoint: number;
  baseRate: number;
  rules: RewardRule[];
  rotating: RotatingProgram | null;
}

export interface RewardCardDTO {
  accountId: string;
  name: string;
  color: string;
  institution: string | null;
  officialName: string | null;
  profile: RewardProfileDTO | null;
}

export async function getRewardCards(
  householdId: string,
  today = new Date(),
): Promise<{ cards: RewardCardDTO[]; progress: CapProgressDTO[] }> {
  // Year start covers the current month, quarter and year windows.
  const since = periodStart("YEAR", today);
  const [accounts, progressRows] = await Promise.all([
    prisma.financialAccount.findMany({
      where: { householdId, type: "CREDIT_CARD", archived: false },
      orderBy: { name: "asc" },
      include: {
        cardRewardProfile: true,
        plaidLinkedAccounts: { select: { officialName: true }, take: 1 },
      },
    }),
    prisma.cardCapProgress.findMany({
      where: { householdId, periodStart: { gte: since } },
    }),
  ]);

  const cards = accounts.map((a): RewardCardDTO => {
    const p = a.cardRewardProfile;
    return {
      accountId: a.id,
      name: a.name,
      color: a.color,
      institution: a.institution,
      officialName: a.plaidLinkedAccounts[0]?.officialName ?? null,
      profile: p
        ? {
            id: p.id,
            catalogCardId: p.catalogCardId,
            currency: p.currency,
            programName: p.programName,
            centsPerPoint: toNumber(p.centsPerPoint),
            baseRate: toNumber(p.baseRate),
            rules: parseRules(p.rules),
            rotating: parseRotating(p.rotating),
          }
        : null,
    };
  });

  const progress = progressRows.map((r): CapProgressDTO => ({
    profileId: r.profileId,
    capKey: r.capKey,
    periodStart: isoDay(r.periodStart),
    spent: toNumber(r.spent),
    activated: r.activated,
  }));

  return { cards, progress };
}

export function toRankInputs(cards: RewardCardDTO[]): RankInputProfile[] {
  return cards.flatMap((c) =>
    c.profile
      ? [
          {
            profileId: c.profile.id,
            accountId: c.accountId,
            name: c.name,
            color: c.color,
            currency: c.profile.currency,
            centsPerPoint: c.profile.centsPerPoint,
            baseRate: c.profile.baseRate,
            rules: c.profile.rules,
            rotating: c.profile.rotating,
          },
        ]
      : [],
  );
}
