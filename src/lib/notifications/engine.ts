import { prisma } from "@/lib/prisma";
import { todayInZone } from "@/lib/user-tz";
import { renderTemplate } from "./render";
import { sendDiscord } from "./discord";
import { TRIGGER_BY_ID } from "./triggers";
import type { NotificationEventPayload, TriggerEvent, TriggerMode } from "./types";

export interface RunOptions {
  mode: TriggerMode;
  event?: NotificationEventPayload;
  /** Restrict to a single rule (used by "Send test"); bypasses the enabled + mode filters. */
  ruleId?: string;
  /** Synthesize a sample event when nothing fires and bypass dedupe. */
  test?: boolean;
}

export interface RunSummary {
  created: number;
  delivered: number;
  failed: number;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "P2002";
}

/** Evaluate matching rules, insert inbox rows, and deliver to channels.
 *  Per-rule error isolation, dedupe skip on P2002, and delivery failures that
 *  never block the inbox row. */
export async function runRules(userId: string, opts: RunOptions): Promise<RunSummary> {
  const rules = await prisma.notificationRule.findMany({
    where: opts.ruleId ? { id: opts.ruleId, userId } : { userId, enabled: true },
    include: { channel: true },
  });

  const todayISO = todayInZone(process.env.TZ);
  const now = new Date();
  const summary: RunSummary = { created: 0, delivered: 0, failed: 0 };

  for (const rule of rules) {
    const def = TRIGGER_BY_ID.get(rule.trigger);
    if (!def) continue;
    if (!opts.ruleId && !def.modes.includes(opts.mode)) continue;

    let events: TriggerEvent[];
    try {
      const params = def.paramsSchema.parse(JSON.parse(rule.params)) as Record<string, unknown>;
      events = await def.evaluate({ userId, params, todayISO, now, event: opts.event });
    } catch (err) {
      console.error(`notification rule ${rule.id} (${rule.trigger}) failed to evaluate:`, err);
      continue;
    }

    if (opts.test && events.length === 0) {
      events = [{ dedupeKey: "sample", vars: def.sampleVars }];
    }

    for (const event of events) {
      const dedupeKey = opts.test ? `test:${Date.now()}:${event.dedupeKey}` : event.dedupeKey;
      const title = renderTemplate(rule.templateTitle ?? def.defaultTemplate.title, event.vars);
      const body = renderTemplate(rule.templateBody ?? def.defaultTemplate.body, event.vars);

      let row: { id: string };
      try {
        row = await prisma.notification.create({
          data: { userId, ruleId: rule.id, ruleName: rule.name, title, body, dedupeKey },
        });
      } catch (err) {
        if (isUniqueViolation(err)) continue;
        throw err;
      }
      summary.created++;

      if (rule.channel) {
        try {
          await sendDiscord(rule.channel.webhookUrl, { title, body, severity: def.severity });
          await prisma.notification.update({ where: { id: row.id }, data: { deliveryStatus: "sent" } });
          summary.delivered++;
        } catch (err) {
          await prisma.notification.update({
            where: { id: row.id },
            data: { deliveryStatus: "failed", deliveryError: err instanceof Error ? err.message : String(err) },
          });
          summary.failed++;
        }
      }
    }
  }

  return summary;
}
