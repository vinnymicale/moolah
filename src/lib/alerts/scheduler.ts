// The in-process alert scheduler, a sibling of the backup scheduler: on a
// long-lived server it registers a per-user cron task from each enabled
// AlertConfig and fires runAlertForUser on schedule. rescheduleUser re-reads a
// user's config so changing the schedule in Settings takes effect without a
// restart. No-op on serverless; booted from src/instrumentation.ts.

import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "@/lib/prisma";
import { runAlertForUser } from "./run";

// userId -> its live cron task, so we can stop/replace it on reschedule.
const tasks = new Map<string, ScheduledTask>();
let started = false;

function stopUser(userId: string): void {
  const existing = tasks.get(userId);
  if (existing) {
    void existing.stop();
    tasks.delete(userId);
  }
}

/**
 * (Re)load one user's AlertConfig and align their cron task with it: schedule
 * when enabled with a valid cron, stop otherwise. Safe to call repeatedly - it
 * always replaces any existing task for that user.
 */
export async function rescheduleUser(userId: string): Promise<void> {
  stopUser(userId);

  const config = await prisma.alertConfig.findUnique({ where: { userId } });
  if (!config || !config.enabled) return;
  if (!cron.validate(config.cron)) {
    console.warn(`[alerts] invalid cron "${config.cron}" for user ${userId}; not scheduling`);
    return;
  }

  const task = cron.schedule(config.cron, async () => {
    try {
      await runAlertForUser(userId);
    } catch (e) {
      // runAlertForUser already recorded the error on the config row; log so
      // it's visible in server output too. Never throw out of the timer.
      console.error(`[alerts] scheduled send failed for user ${userId}:`, e);
    }
  });
  tasks.set(userId, task);
}

/**
 * Register cron tasks for every enabled AlertConfig. Called once at server
 * boot. Idempotent: a second call is ignored, so repeated module evaluation or
 * an accidental double-invocation won't stack duplicate timers.
 */
export async function startAlertScheduler(): Promise<void> {
  if (started) return;
  started = true;

  let configs;
  try {
    configs = await prisma.alertConfig.findMany({ where: { enabled: true } });
  } catch (e) {
    // Don't take the server down if the DB isn't reachable at boot (e.g.
    // migrations still running). The scheduler just stays empty.
    console.error("[alerts] could not load alert configs at startup:", e);
    return;
  }

  for (const config of configs) {
    await rescheduleUser(config.userId);
  }
  if (tasks.size > 0) {
    console.log(`[alerts] scheduled ${tasks.size} alert job(s)`);
  }
}

// Test-only: reset module state between cases.
export function _resetSchedulerForTests(): void {
  for (const t of tasks.values()) void t.stop();
  tasks.clear();
  started = false;
}
