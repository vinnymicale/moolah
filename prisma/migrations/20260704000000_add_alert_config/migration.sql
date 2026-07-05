-- Per-user outbound notification configuration: a scheduled digest of upcoming
-- bills, credit-card due dates and over-budget categories, delivered to an
-- ntfy topic or a generic JSON webhook.
CREATE TABLE "AlertConfig" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "kind" TEXT NOT NULL DEFAULT 'ntfy',
    "url" TEXT NOT NULL DEFAULT '',
    "cron" TEXT NOT NULL DEFAULT '0 8 * * *',
    "billsDays" INTEGER NOT NULL DEFAULT 3,
    "budgetsEnabled" BOOLEAN NOT NULL DEFAULT true,
    "lastRunAt" TIMESTAMP(3),
    "lastStatus" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AlertConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AlertConfig_userId_key" ON "AlertConfig"("userId");

ALTER TABLE "AlertConfig" ADD CONSTRAINT "AlertConfig_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
