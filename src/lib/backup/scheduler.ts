// The in-process backup scheduler. On a long-lived server (self-hosted Docker /
// `npm start`) it registers a per-user cron task from each enabled BackupConfig
// and fires runScheduledBackupForUser on schedule. It re-reads a user's config
// on demand (rescheduleUser) so changing the schedule in Settings takes effect
// without a restart.
//
// This only makes sense where one Node process stays alive. It's a no-op on
// serverless, and guarded against double-registration (Next can evaluate a
// module more than once). The boot entry point is src/instrumentation.ts.

import cron, { type ScheduledTask } from "node-cron";
import { prisma } from "@/lib/prisma";
import { runScheduledBackupForUser } from "./run";

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
 * (Re)load one user's BackupConfig and align their cron task with it: schedule
 * when enabled with a valid cron, stop otherwise. Safe to call repeatedly - it
 * always replaces any existing task for that user.
 */
export async function rescheduleUser(userId: string): Promise<void> {
  stopUser(userId);

  const config = await prisma.backupConfig.findUnique({ where: { userId } });
  if (!config || !config.enabled) return;
  if (!cron.validate(config.cron)) {
    console.warn(`[backup] invalid cron "${config.cron}" for user ${userId}; not scheduling`);
    return;
  }

  const task = cron.schedule(config.cron, async () => {
    try {
      await runScheduledBackupForUser(userId);
    } catch (e) {
      // runScheduledBackupForUser already recorded the error on the config row;
      // log so it's visible in server output too. Never throw out of the timer.
      console.error(`[backup] scheduled run failed for user ${userId}:`, e);
    }
  });
  tasks.set(userId, task);
}

/**
 * Register cron tasks for every enabled BackupConfig. Called once at server
 * boot. Idempotent: a second call is ignored, so repeated module evaluation or
 * an accidental double-invocation won't stack duplicate timers.
 */
export async function startScheduler(): Promise<void> {
  if (started) return;
  started = true;

  let configs;
  try {
    configs = await prisma.backupConfig.findMany({ where: { enabled: true } });
  } catch (e) {
    // Don't take the server down if the DB isn't reachable at boot (e.g.
    // migrations still running). The scheduler just stays empty.
    console.error("[backup] could not load backup configs at startup:", e);
    return;
  }

  for (const config of configs) {
    await rescheduleUser(config.userId);
  }
  if (tasks.size > 0) {
    console.log(`[backup] scheduled ${tasks.size} backup job(s)`);
  }
}

// Test-only: reset module state between cases.
export function _resetSchedulerForTests(): void {
  for (const t of tasks.values()) void t.stop();
  tasks.clear();
  started = false;
}
