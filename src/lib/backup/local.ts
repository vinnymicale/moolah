// Local-filesystem backup destination: writes backups to a directory on the
// server. The default is ./backups (matching the db:backup CLI), overridable
// with BACKUP_LOCAL_DIR so a Docker deploy can point it at a mounted volume on
// a different disk / NAS share.

import { mkdir, writeFile, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { type BackupDestination, type StoredBackup, isBackupName } from "./destination";

export function localBackupDir(): string {
  return resolve(process.cwd(), process.env.BACKUP_LOCAL_DIR || "backups");
}

export class LocalDestination implements BackupDestination {
  constructor(private readonly dir: string = localBackupDir()) {}

  async put(name: string, data: Buffer): Promise<void> {
    await mkdir(this.dir, { recursive: true });
    await writeFile(resolve(this.dir, name), data);
  }

  async list(): Promise<StoredBackup[]> {
    let entries: string[];
    try {
      entries = await readdir(this.dir);
    } catch (e) {
      // No directory yet means no backups, not an error.
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    return entries.filter(isBackupName).map((name) => ({ name }));
  }

  async delete(name: string): Promise<void> {
    await unlink(resolve(this.dir, name));
  }
}
