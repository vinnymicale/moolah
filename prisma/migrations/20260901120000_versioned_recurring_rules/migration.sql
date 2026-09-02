-- Split RecurringRule into a stable identity row plus a list of versions, so a
-- rule can be edited going forward without rewriting what past months looked like.

CREATE TABLE "RecurringRuleVersion" (
    "id" TEXT NOT NULL,
    "ruleId" TEXT NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "accountId" TEXT,
    "categoryId" TEXT,
    "type" "TxnType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "note" TEXT,
    "frequency" "Frequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "dayOfMonth" INTEGER,
    "weekday" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecurringRuleVersion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RecurringRuleVersion_ruleId_idx" ON "RecurringRuleVersion"("ruleId");
CREATE UNIQUE INDEX "RecurringRuleVersion_ruleId_effectiveFrom_key" ON "RecurringRuleVersion"("ruleId", "effectiveFrom");

ALTER TABLE "RecurringRuleVersion" ADD CONSTRAINT "RecurringRuleVersion_ruleId_fkey"
    FOREIGN KEY ("ruleId") REFERENCES "RecurringRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringRuleVersion" ADD CONSTRAINT "RecurringRuleVersion_accountId_fkey"
    FOREIGN KEY ("accountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecurringRuleVersion" ADD CONSTRAINT "RecurringRuleVersion_categoryId_fkey"
    FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed one version per existing rule, effective from the day the series began.
INSERT INTO "RecurringRuleVersion" (
    "id", "ruleId", "effectiveFrom", "accountId", "categoryId", "type", "amount",
    "note", "frequency", "interval", "startDate", "endDate", "dayOfMonth", "weekday", "createdAt"
)
SELECT
    md5(random()::text || clock_timestamp()::text)::uuid::text,
    "id", "startDate", "accountId", "categoryId", "type", "amount",
    "note", "frequency", "interval", "startDate", "endDate", "dayOfMonth", "weekday", "createdAt"
FROM "RecurringRule";

ALTER TABLE "RecurringRule" DROP CONSTRAINT IF EXISTS "RecurringRule_accountId_fkey";
ALTER TABLE "RecurringRule" DROP CONSTRAINT IF EXISTS "RecurringRule_categoryId_fkey";

ALTER TABLE "RecurringRule"
    DROP COLUMN "accountId",
    DROP COLUMN "categoryId",
    DROP COLUMN "type",
    DROP COLUMN "amount",
    DROP COLUMN "note",
    DROP COLUMN "frequency",
    DROP COLUMN "interval",
    DROP COLUMN "startDate",
    DROP COLUMN "endDate",
    DROP COLUMN "dayOfMonth",
    DROP COLUMN "weekday";
