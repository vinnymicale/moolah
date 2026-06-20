-- Per-user configuration for scheduled, retention-managed backups to a chosen
-- destination (local volume, Dropbox, Google Drive). Credentials are stored
-- encrypted with ENCRYPTION_KEY, same format as Plaid/AI secrets.
CREATE TABLE "BackupConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "destination" TEXT NOT NULL DEFAULT 'local',
    "cron" TEXT NOT NULL DEFAULT '0 3 * * *',
    "keepCount" INTEGER NOT NULL DEFAULT 7,
    "credentials" TEXT,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "lastBackupName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BackupConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BackupConfig_userId_key" ON "BackupConfig"("userId");

ALTER TABLE "BackupConfig" ADD CONSTRAINT "BackupConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
