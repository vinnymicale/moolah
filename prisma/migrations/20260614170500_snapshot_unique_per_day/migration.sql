-- Enforce one AccountSnapshot per account per day so the daily net-worth capture
-- is idempotent. Collapse any pre-existing same-day duplicates first (keep the
-- most recently created row), then swap the plain index for a unique one.

DELETE FROM "AccountSnapshot" a
USING "AccountSnapshot" b
WHERE a."accountId" = b."accountId"
  AND a."date" = b."date"
  AND a."createdAt" < b."createdAt";

DROP INDEX IF EXISTS "AccountSnapshot_accountId_date_idx";

CREATE UNIQUE INDEX "AccountSnapshot_accountId_date_key" ON "AccountSnapshot"("accountId", "date");
