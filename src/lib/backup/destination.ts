// A backup destination is anywhere a backup file can be written, listed, and
// deleted: a local volume, Dropbox, Google Drive, etc. Each concrete impl only
// has to move bytes - scheduling and retention live above this interface, so a
// new provider is just a new put/list/delete.

export interface StoredBackup {
  // The backup filename, e.g. moolah-backup-2026-06-12_04-30-08.json. The
  // timestamp embedded here (via backupStamp) is what retention sorts on, so it
  // doesn't depend on a provider's own modified-time metadata.
  name: string;
}

export interface BackupDestination {
  put(name: string, data: Buffer): Promise<void>;
  list(): Promise<StoredBackup[]>;
  delete(name: string): Promise<void>;
}

// Only our own backups match this, so list()/prune never touch unrelated files
// the user may keep in the same folder.
const BACKUP_NAME = /^moolah-backup-.+\.json$/;

export function isBackupName(name: string): boolean {
  return BACKUP_NAME.test(name);
}

/**
 * Decide which backups to delete to honour a keepCount, given the names
 * currently at a destination. Sorts by the timestamp embedded in the filename
 * (lexicographic order matches chronological order for backupStamp's
 * YYYY-MM-DD_HH-MM-SS format) and returns the oldest names beyond keepCount.
 *
 * Pure and provider-agnostic so it's unit-testable without any I/O; callers
 * pass list() output in and feed the result back to delete().
 */
export function namesToPrune(names: string[], keepCount: number): string[] {
  const backups = names.filter(isBackupName).sort(); // oldest first
  if (keepCount <= 0) return backups; // keep nothing - prune all
  const excess = backups.length - keepCount;
  if (excess <= 0) return [];
  return backups.slice(0, excess);
}
