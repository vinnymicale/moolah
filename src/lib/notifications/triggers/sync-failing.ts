import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { TriggerDef } from "../types";

export const syncFailing: TriggerDef = {
  id: "sync-failing",
  label: "Sync keeps failing",
  description: "A bank connection has failed to sync several times in a row.",
  group: "connection",
  modes: ["event"],
  severity: "warning",
  paramsSchema: z.object({
    failures: z.number().int().min(1).max(20).default(3),
  }),
  paramFields: [
    { key: "failures", label: "Consecutive failures", kind: "number", min: 1, max: 20 },
  ],
  variables: [
    { name: "institution", description: "Institution name" },
    { name: "failures", description: "Consecutive failure count" },
    { name: "error", description: "Last sync error message" },
  ],
  defaultTemplate: {
    title: "{{institution}} sync failing",
    body: "{{institution}} has failed to sync {{failures}} times in a row. Last error: {{error}}",
  },
  sampleVars: { institution: "Sample Bank", failures: "3", error: "RATE_LIMIT_EXCEEDED" },
  async evaluate(ctx) {
    const { failures } = ctx.params as { failures: number };
    const event = ctx.event;
    if (!event || event.kind !== "plaid-sync-failed" || !event.plaidItemId) return [];
    if (event.reauthRequired) return []; // plaid-reauth owns login failures
    if ((event.failureCount ?? 0) < failures) return [];
    const item = await prisma.plaidItem.findUnique({
      where: { id: event.plaidItemId },
      select: { institutionName: true, error: true },
    });
    if (!item) return [];
    return [
      {
        dedupeKey: `sync-failing:${event.plaidItemId}:${ctx.todayISO}`,
        vars: {
          institution: item.institutionName ?? "Bank connection",
          failures: String(event.failureCount),
          error: item.error ?? "",
        },
      },
    ];
  },
};
