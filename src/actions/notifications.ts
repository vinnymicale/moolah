"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUser } from "@/lib/session";
import { run, UserError, type ActionResult } from "@/lib/action-result";
import { isDemoMode } from "@/lib/demo-guard";
import { isValidDiscordWebhookUrl } from "@/lib/notifications/discord";
import { TRIGGER_BY_ID } from "@/lib/notifications/triggers";

export async function saveChannelAction(input: {
  id?: string;
  name: string;
  webhookUrl: string;
}): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const name = input.name.trim();
    if (!name) throw new UserError("Channel name is required.");
    if (!isValidDiscordWebhookUrl(input.webhookUrl)) {
      throw new UserError("That doesn't look like a Discord webhook URL (https://discord.com/api/webhooks/...).");
    }
    if (input.id) {
      const existing = await prisma.notificationChannel.findFirst({ where: { id: input.id, userId } });
      if (!existing) throw new UserError("Channel not found.");
      await prisma.notificationChannel.update({
        where: { id: input.id },
        data: { name, webhookUrl: input.webhookUrl },
      });
    } else {
      await prisma.notificationChannel.create({
        data: { userId, name, kind: "discord", webhookUrl: input.webhookUrl },
      });
    }
    revalidatePath("/notifications");
  });
}

export async function deleteChannelAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.notificationChannel.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Channel not found.");
    // Rules pointing here fall back to in-app only via onDelete: SetNull.
    await prisma.notificationChannel.delete({ where: { id } });
    revalidatePath("/notifications");
  });
}

export async function saveRuleAction(input: {
  id?: string;
  name: string;
  trigger: string;
  params: string;
  channelId: string | null;
  templateTitle: string | null;
  templateBody: string | null;
}): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const name = input.name.trim();
    if (!name) throw new UserError("Rule name is required.");
    const def = TRIGGER_BY_ID.get(input.trigger);
    if (!def) throw new UserError("Unknown trigger.");

    let rawParams: unknown;
    try {
      rawParams = JSON.parse(input.params);
    } catch {
      throw new UserError("Invalid rule parameters.");
    }
    const parsed = def.paramsSchema.safeParse(rawParams);
    if (!parsed.success) {
      throw new UserError(parsed.error.issues[0]?.message ?? "Invalid rule parameters.");
    }
    const params = JSON.stringify(parsed.data);

    if (input.channelId) {
      const channel = await prisma.notificationChannel.findFirst({
        where: { id: input.channelId, userId },
      });
      if (!channel) throw new UserError("Channel not found.");
    }

    const data = {
      name,
      trigger: input.trigger,
      params,
      channelId: input.channelId,
      templateTitle: input.templateTitle?.trim() || null,
      templateBody: input.templateBody?.trim() || null,
    };
    if (input.id) {
      const existing = await prisma.notificationRule.findFirst({ where: { id: input.id, userId } });
      if (!existing) throw new UserError("Rule not found.");
      await prisma.notificationRule.update({ where: { id: input.id }, data });
    } else {
      await prisma.notificationRule.create({ data: { ...data, userId } });
    }
    revalidatePath("/notifications");
  });
}

export async function setRuleEnabledAction(id: string, enabled: boolean): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.notificationRule.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Rule not found.");
    await prisma.notificationRule.update({ where: { id }, data: { enabled } });
    revalidatePath("/notifications");
  });
}

export async function deleteRuleAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.notificationRule.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Rule not found.");
    await prisma.notificationRule.delete({ where: { id } });
    revalidatePath("/notifications");
  });
}

export async function testRuleAction(id: string): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    const existing = await prisma.notificationRule.findFirst({ where: { id, userId } });
    if (!existing) throw new UserError("Rule not found.");
    const { runRules } = await import("@/lib/notifications/engine");
    const summary = await runRules(userId, { mode: "sweep", ruleId: id, test: true });
    if (summary.failed > 0) {
      throw new UserError("Test fired, but delivery failed - check the inbox entry for the error.");
    }
    revalidatePath("/notifications");
  });
}

export async function markReadAction(ids: string[] | "all"): Promise<ActionResult> {
  if (isDemoMode()) return { ok: true };
  return run(async () => {
    const { userId } = await requireUser();
    await prisma.notification.updateMany({
      where: ids === "all" ? { userId, readAt: null } : { userId, id: { in: ids }, readAt: null },
      data: { readAt: new Date() },
    });
    // The layout renders the sidebar badge, so refresh the whole tree.
    revalidatePath("/", "layout");
  });
}
