-- Budget rollover: when enabled, last month's leftover (or overspend) carries
-- into this month's effective limit.
ALTER TABLE "Budget" ADD COLUMN "rollover" BOOLEAN NOT NULL DEFAULT false;
