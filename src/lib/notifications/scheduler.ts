import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "@/lib/prisma";
import { runRules } from "./engine";

let started = false;
let task: ScheduledTask | null = null;

/** One global sweep every 15 minutes. Time-based triggers self-gate via
 *  dedupe keys, so re-running is cheap and safe. */
export async function startNotificationScheduler(): Promise<void> {
  if (started) return;
  started = true;
  task = cron.schedule("*/15 * * * *", async () => {
    try {
      await sweep();
    } catch (e) {
      // Never let a sweep failure take the timer down.
      console.error("[notifications] sweep failed:", e);
    }
  });
  console.log("[notifications] scheduler started (sweep every 15 minutes)");
}

export async function sweep(): Promise<void> {
  // Rules belong to a user, but the data they read belongs to that user's
  // household, so the membership row supplies the ledger to query.
  const members = await prisma.notificationRule.findMany({
    where: { enabled: true },
    select: { user: { select: { id: true, membership: { select: { householdId: true } } } } },
    distinct: ["userId"],
  });
  for (const { user } of members) {
    const householdId = user.membership?.householdId;
    if (!householdId) continue;
    try {
      await runRules(user.id, householdId, { mode: "sweep" });
    } catch (e) {
      console.error(`[notifications] sweep failed for user ${user.id}:`, e);
    }
  }
}

export function _resetSchedulerForTests(): void {
  task?.stop();
  task = null;
  started = false;
}
