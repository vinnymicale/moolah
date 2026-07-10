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
  const users = await prisma.notificationRule.findMany({
    where: { enabled: true },
    select: { userId: true },
    distinct: ["userId"],
  });
  for (const { userId } of users) {
    try {
      await runRules(userId, { mode: "sweep" });
    } catch (e) {
      console.error(`[notifications] sweep failed for user ${userId}:`, e);
    }
  }
}

export function _resetSchedulerForTests(): void {
  task?.stop();
  task = null;
  started = false;
}
