"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireCapability } from "@/lib/household";
import { recordAudit } from "@/lib/audit";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { DbNull } from "@/generated/prisma/internal/prismaNamespace";
import { findCatalogCard } from "@/lib/card-rewards/catalog";
import { periodStart } from "@/lib/card-rewards/rank";
import {
  parseRotating,
  parseRules,
  rewardProfileInputSchema,
  ROTATING_CAP_KEY,
  type CapPeriod,
  type RewardProfileInput,
} from "@/lib/card-rewards/types";

const REWARDS_PATH = "/accounts/rewards";

const spentSchema = z.number().min(0, "Spent can't be negative").max(10_000_000);

async function ownedProfile(profileId: string, householdId: string) {
  const profile = await prisma.cardRewardProfile.findFirst({
    where: { id: profileId, householdId },
    include: { financialAccount: { select: { name: true } } },
  });
  if (!profile) throw new UserError("Rewards profile not found");
  return profile;
}

export async function createRewardProfileAction(
  accountId: string,
  catalogCardId: string | null,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId, householdId } = await requireCapability("MANAGE_ACCOUNTS");
    const account = await prisma.financialAccount.findFirst({
      where: { id: accountId, householdId },
      select: { id: true, name: true, type: true, cardRewardProfile: { select: { id: true } } },
    });
    if (!account) throw new UserError("Account not found");
    if (account.type !== "CREDIT_CARD") throw new UserError("Only credit cards earn rewards");
    if (account.cardRewardProfile) throw new UserError("This card already has rewards set up");

    const card = catalogCardId ? findCatalogCard(catalogCardId) : null;
    if (catalogCardId && !card) throw new UserError("Unknown card");

    const created = await prisma.cardRewardProfile.create({
      data: {
        householdId,
        financialAccountId: account.id,
        catalogCardId: card?.id ?? null,
        currency: card?.currency ?? "CASH",
        programName: card?.programName ?? null,
        centsPerPoint: card?.defaultCentsPerPoint ?? 1,
        baseRate: card?.baseRate ?? 1,
        rules: card?.rules ?? [],
        rotating: card?.rotating ?? DbNull,
      },
    });
    await recordAudit({
      householdId,
      actorId: userId,
      action: "rewards.create",
      entityType: "CardRewardProfile",
      entityId: created.id,
      summary: card ? `${account.name} (${card.name})` : account.name,
    });
    revalidatePath(REWARDS_PATH);
  });
}

export async function updateRewardProfileAction(
  profileId: string,
  input: RewardProfileInput,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId, householdId } = await requireCapability("MANAGE_ACCOUNTS");
    const data = rewardProfileInputSchema.parse(input);
    const profile = await ownedProfile(profileId, householdId);
    await prisma.cardRewardProfile.update({
      where: { id: profile.id },
      data: {
        currency: data.currency,
        programName: data.programName || null,
        centsPerPoint: data.centsPerPoint,
        baseRate: data.baseRate,
        rules: data.rules,
        rotating: data.rotating ?? DbNull,
      },
    });
    await recordAudit({
      householdId,
      actorId: userId,
      action: "rewards.update",
      entityType: "CardRewardProfile",
      entityId: profile.id,
      summary: profile.financialAccount.name,
    });
    revalidatePath(REWARDS_PATH);
  });
}

export async function deleteRewardProfileAction(profileId: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId, householdId } = await requireCapability("MANAGE_ACCOUNTS");
    const profile = await ownedProfile(profileId, householdId);
    await prisma.cardRewardProfile.delete({ where: { id: profile.id } });
    await recordAudit({
      householdId,
      actorId: userId,
      action: "rewards.delete",
      entityType: "CardRewardProfile",
      entityId: profile.id,
      summary: profile.financialAccount.name,
    });
    revalidatePath(REWARDS_PATH);
  });
}

export async function setCapProgressAction(
  profileId: string,
  capKey: string,
  spent: number,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireCapability("MANAGE_ACCOUNTS");
    const amount = spentSchema.parse(spent);
    const profile = await ownedProfile(profileId, householdId);

    let period: CapPeriod;
    if (capKey === ROTATING_CAP_KEY) {
      if (!parseRotating(profile.rotating)) throw new UserError("This card has no rotating categories");
      period = "QUARTER";
    } else {
      const rule = parseRules(profile.rules).find((r) => r.category === capKey);
      if (!rule) throw new UserError("That category has no rate on this card");
      if (!rule.cap) throw new UserError("That rate has no cap");
      period = rule.cap.period;
    }

    const start = periodStart(period, new Date());
    await prisma.cardCapProgress.upsert({
      where: { profileId_capKey_periodStart: { profileId: profile.id, capKey, periodStart: start } },
      create: { householdId, profileId: profile.id, capKey, periodStart: start, spent: amount },
      update: { spent: amount },
    });
    revalidatePath(REWARDS_PATH);
  });
}

export async function setRotatingActivatedAction(
  profileId: string,
  activated: boolean,
): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { householdId } = await requireCapability("MANAGE_ACCOUNTS");
    const profile = await ownedProfile(profileId, householdId);
    if (!parseRotating(profile.rotating)) throw new UserError("This card has no rotating categories");

    const start = periodStart("QUARTER", new Date());
    const capKey = ROTATING_CAP_KEY;
    await prisma.cardCapProgress.upsert({
      where: { profileId_capKey_periodStart: { profileId: profile.id, capKey, periodStart: start } },
      create: { householdId, profileId: profile.id, capKey, periodStart: start, activated },
      update: { activated },
    });
    revalidatePath(REWARDS_PATH);
  });
}
