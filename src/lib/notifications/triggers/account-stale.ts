import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { TriggerDef } from "../types";

const DAY_MS = 86_400_000;

export const accountStale: TriggerDef = {
  id: "account-stale",
  label: "Connection hasn't synced in a while",
  description: "A bank connection hasn't successfully synced for N days.",
  group: "connection",
  modes: ["sweep"],
  severity: "warning",
  paramsSchema: z.object({
    days: z.number().int().min(1).max(60).default(3),
  }),
  paramFields: [{ key: "days", label: "Days without a sync", kind: "number", min: 1, max: 60 }],
  variables: [
    { name: "institution", description: "Institution name" },
    { name: "days", description: "Days since the last successful sync" },
  ],
  defaultTemplate: {
    title: "{{institution}} hasn't synced in {{days}} days",
    body: "The last successful sync for {{institution}} was {{days}} days ago.",
  },
  sampleVars: { institution: "Sample Bank", days: "4" },
  async evaluate(ctx) {
    const { days } = ctx.params as { days: number };
    const items = await prisma.plaidItem.findMany({
      where: { userId: ctx.userId, lastSyncedAt: { not: null } },
      select: { id: true, institutionName: true, lastSyncedAt: true },
    });
    const events = [];
    for (const item of items) {
      if (!item.lastSyncedAt) continue;
      const staleDays = Math.floor((ctx.now.getTime() - item.lastSyncedAt.getTime()) / DAY_MS);
      if (staleDays < days) continue;
      events.push({
        dedupeKey: `account-stale:${item.id}:${ctx.todayISO}`,
        vars: { institution: item.institutionName ?? "Bank connection", days: String(staleDays) },
      });
    }
    return events;
  },
};
