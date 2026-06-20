// The shared backup-run core: export the database, write it to the configured
// destination, then prune old copies to honour keepCount. Called both by the
// "Run now" button and the scheduler, so a manual run and a scheduled run are
// byte-for-byte the same operation.

import { prisma } from "@/lib/prisma";
import { exportAllData, backupStamp } from "./index";
import { namesToPrune, type BackupDestination } from "./destination";
import { destinationFor } from "./factory";

export interface BackupRunResult {
  name: string;
  bytes: number;
  pruned: string[];
}

/**
 * Run one backup against a given destination: dump the DB to JSON, write it
 * under a timestamped name, then delete the oldest copies beyond keepCount.
 *
 * Pure of any config/status bookkeeping - it takes the destination and retention
 * count directly - so it's unit-testable with a fake destination and no DB
 * status row. runScheduledBackupForUser wraps it with the BackupConfig lookup
 * and lastRun* updates.
 */
export async function performBackup(
  dest: BackupDestination,
  keepCount: number,
): Promise<BackupRunResult> {
  const payload = await exportAllData();
  const name = `moolah-backup-${backupStamp(payload.exportedAt)}.json`;
  const data = Buffer.from(JSON.stringify(payload));
  await dest.put(name, data);

  // Prune only after a successful write, so a failed upload never deletes a
  // good older backup. List again so the just-written file is counted.
  const existing = await dest.list();
  const pruned = namesToPrune(
    existing.map((b) => b.name),
    keepCount,
  );
  for (const old of pruned) await dest.delete(old);

  return { name, bytes: data.length, pruned };
}

/**
 * Run a backup for one user from their stored BackupConfig, recording the
 * outcome on the config row (lastRunAt/lastStatus/lastError/lastBackupName) so
 * the Settings UI can show it. Throws on failure after recording the error.
 */
export async function runScheduledBackupForUser(userId: string): Promise<BackupRunResult> {
  const config = await prisma.backupConfig.findUnique({ where: { userId } });
  if (!config) throw new Error("No backup configuration for this user.");

  await prisma.backupConfig.update({
    where: { userId },
    data: { lastStatus: "running", lastError: null },
  });

  try {
    const dest = destinationFor(config);
    const result = await performBackup(dest, config.keepCount);
    await prisma.backupConfig.update({
      where: { userId },
      data: {
        lastRunAt: new Date(),
        lastStatus: "success",
        lastError: null,
        lastBackupName: result.name,
      },
    });
    return result;
  } catch (e) {
    const message = e instanceof Error ? e.message : "Backup failed.";
    await prisma.backupConfig.update({
      where: { userId },
      data: { lastRunAt: new Date(), lastStatus: "error", lastError: message },
    });
    throw e;
  }
}
