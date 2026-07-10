import { prisma } from "@/lib/prisma";

export interface NotificationDTO {
  id: string;
  ruleName: string;
  title: string;
  body: string;
  firedAt: string;
  readAt: string | null;
  deliveryStatus: string;
  deliveryError: string | null;
}

export async function getNotifications(userId: string, limit = 50): Promise<NotificationDTO[]> {
  const rows = await prisma.notification.findMany({
    where: { userId },
    orderBy: { firedAt: "desc" },
    take: limit,
  });
  return rows.map((n) => ({
    id: n.id,
    ruleName: n.ruleName,
    title: n.title,
    body: n.body,
    firedAt: n.firedAt.toISOString(),
    readAt: n.readAt ? n.readAt.toISOString() : null,
    deliveryStatus: n.deliveryStatus,
    deliveryError: n.deliveryError,
  }));
}

export async function getUnreadNotificationCount(userId: string): Promise<number> {
  return prisma.notification.count({ where: { userId, readAt: null } });
}

export interface ChannelDTO {
  id: string;
  name: string;
  kind: string;
  webhookUrl: string;
}

export async function getNotificationChannels(userId: string): Promise<ChannelDTO[]> {
  const rows = await prisma.notificationChannel.findMany({
    where: { userId },
    orderBy: { name: "asc" },
  });
  return rows.map((c) => ({ id: c.id, name: c.name, kind: c.kind, webhookUrl: c.webhookUrl }));
}

export interface RuleDTO {
  id: string;
  name: string;
  enabled: boolean;
  trigger: string;
  params: string;
  channelId: string | null;
  templateTitle: string | null;
  templateBody: string | null;
}

export async function getNotificationRules(userId: string): Promise<RuleDTO[]> {
  const rows = await prisma.notificationRule.findMany({
    where: { userId },
    orderBy: { createdAt: "asc" },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    enabled: r.enabled,
    trigger: r.trigger,
    params: r.params,
    channelId: r.channelId,
    templateTitle: r.templateTitle,
    templateBody: r.templateBody,
  }));
}
