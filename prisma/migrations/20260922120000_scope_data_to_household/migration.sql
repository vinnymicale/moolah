-- Scope every financial table to a Household instead of a User.
--
-- This migration carries data, so it cannot use Prisma's generated
-- drop-and-add: each userId column is RENAMEd in place and then rewritten to
-- the owning household's id. Order matters -- households must exist before
-- anything can point at them, and User's credential columns are only dropped
-- after Household has copied them.

-- 1. One household per existing user, id derived from the user's so the
--    backfill below needs no lookup table.
INSERT INTO "Household" ("id", "name", "ownerId", "createdAt", "aiProvider", "aiApiKey", "aiModel", "plaidClientId", "plaidSecret", "plaidEnv", "apiTokenSelector", "apiTokenVerifierHash", "apiTokenCreatedAt")
SELECT
  'hh_' || "id",
  COALESCE("name", 'Household'),
  "id",
  "createdAt",
  "aiProvider", "aiApiKey", "aiModel",
  "plaidClientId", "plaidSecret", "plaidEnv",
  "apiTokenSelector", "apiTokenVerifierHash", "apiTokenCreatedAt"
FROM "User";

-- 2. Each user owns their household.
INSERT INTO "HouseholdMember" ("id", "householdId", "userId", "role", "capabilities", "deniedCapabilities", "joinedAt")
SELECT 'hm_' || "id", 'hh_' || "id", "id", 'OWNER', ARRAY[]::TEXT[], ARRAY[]::TEXT[], "createdAt"
FROM "User";

-- 3. Drop the old user-scoped foreign keys and indexes.
-- DropForeignKey
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_userId_fkey";

-- DropForeignKey
ALTER TABLE "BackupConfig" DROP CONSTRAINT "BackupConfig_userId_fkey";

-- DropForeignKey
ALTER TABLE "Budget" DROP CONSTRAINT "Budget_userId_fkey";

-- DropForeignKey
ALTER TABLE "Category" DROP CONSTRAINT "Category_userId_fkey";

-- DropForeignKey
ALTER TABLE "Contribution" DROP CONSTRAINT "Contribution_userId_fkey";

-- DropForeignKey
ALTER TABLE "ContributionSchedule" DROP CONSTRAINT "ContributionSchedule_userId_fkey";

-- DropForeignKey
ALTER TABLE "EmployerMatch" DROP CONSTRAINT "EmployerMatch_userId_fkey";

-- DropForeignKey
ALTER TABLE "FinancialAccount" DROP CONSTRAINT "FinancialAccount_userId_fkey";

-- DropForeignKey
ALTER TABLE "PlaidItem" DROP CONSTRAINT "PlaidItem_userId_fkey";

-- DropForeignKey
ALTER TABLE "RecurringRule" DROP CONSTRAINT "RecurringRule_userId_fkey";

-- DropForeignKey
ALTER TABLE "RetirementPlan" DROP CONSTRAINT "RetirementPlan_userId_fkey";

-- DropForeignKey
ALTER TABLE "Rule" DROP CONSTRAINT "Rule_userId_fkey";

-- DropForeignKey
ALTER TABLE "RuleRun" DROP CONSTRAINT "RuleRun_userId_fkey";

-- DropForeignKey
ALTER TABLE "SavingsGoal" DROP CONSTRAINT "SavingsGoal_userId_fkey";

-- DropForeignKey
ALTER TABLE "Tag" DROP CONSTRAINT "Tag_userId_fkey";

-- DropForeignKey
ALTER TABLE "Transaction" DROP CONSTRAINT "Transaction_userId_fkey";

-- DropForeignKey
ALTER TABLE "YtdContribution" DROP CONSTRAINT "YtdContribution_userId_fkey";

-- DropIndex
DROP INDEX "Attachment_userId_idx";

-- DropIndex
DROP INDEX "BackupConfig_userId_key";

-- DropIndex
DROP INDEX "Budget_userId_categoryId_month_key";

-- DropIndex
DROP INDEX "Budget_userId_idx";

-- DropIndex
DROP INDEX "Category_userId_idx";

-- DropIndex
DROP INDEX "Contribution_userId_date_idx";

-- DropIndex
DROP INDEX "ContributionSchedule_userId_idx";

-- DropIndex
DROP INDEX "EmployerMatch_userId_idx";

-- DropIndex
DROP INDEX "FinancialAccount_userId_idx";

-- DropIndex
DROP INDEX "PlaidItem_userId_idx";

-- DropIndex
DROP INDEX "RecurringRule_userId_idx";

-- DropIndex
DROP INDEX "RetirementPlan_userId_key";

-- DropIndex
DROP INDEX "Rule_userId_idx";

-- DropIndex
DROP INDEX "RuleRun_userId_createdAt_idx";

-- DropIndex
DROP INDEX "SavingsGoal_userId_idx";

-- DropIndex
DROP INDEX "Tag_userId_idx";

-- DropIndex
DROP INDEX "Tag_userId_name_key";

-- DropIndex
DROP INDEX "Transaction_userId_date_idx";

-- DropIndex
DROP INDEX "Transaction_userId_deletedAt_idx";

-- DropIndex
DROP INDEX "User_apiTokenSelector_key";

-- DropIndex
DROP INDEX "YtdContribution_userId_year_financialAccountId_source_key";

-- DropIndex
DROP INDEX "YtdContribution_userId_year_idx";

-- 4. Rename in place (keeps the data) and repoint at the new household ids.
ALTER TABLE "Attachment" RENAME COLUMN "userId" TO "householdId";
UPDATE "Attachment" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "BackupConfig" RENAME COLUMN "userId" TO "householdId";
UPDATE "BackupConfig" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "Budget" RENAME COLUMN "userId" TO "householdId";
UPDATE "Budget" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "Category" RENAME COLUMN "userId" TO "householdId";
UPDATE "Category" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "Contribution" RENAME COLUMN "userId" TO "householdId";
UPDATE "Contribution" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "ContributionSchedule" RENAME COLUMN "userId" TO "householdId";
UPDATE "ContributionSchedule" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "EmployerMatch" RENAME COLUMN "userId" TO "householdId";
UPDATE "EmployerMatch" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "FinancialAccount" RENAME COLUMN "userId" TO "householdId";
UPDATE "FinancialAccount" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "PlaidItem" RENAME COLUMN "userId" TO "householdId";
UPDATE "PlaidItem" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "RecurringRule" RENAME COLUMN "userId" TO "householdId";
UPDATE "RecurringRule" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "RetirementPlan" RENAME COLUMN "userId" TO "householdId";
UPDATE "RetirementPlan" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "Rule" RENAME COLUMN "userId" TO "householdId";
UPDATE "Rule" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "RuleRun" RENAME COLUMN "userId" TO "householdId";
UPDATE "RuleRun" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "SavingsGoal" RENAME COLUMN "userId" TO "householdId";
UPDATE "SavingsGoal" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "Tag" RENAME COLUMN "userId" TO "householdId";
UPDATE "Tag" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "Transaction" RENAME COLUMN "userId" TO "householdId";
UPDATE "Transaction" SET "householdId" = 'hh_' || "householdId";
ALTER TABLE "YtdContribution" RENAME COLUMN "userId" TO "householdId";
UPDATE "YtdContribution" SET "householdId" = 'hh_' || "householdId";

-- 5. Attribution columns. Backfilled from the household owner so existing rows
--    show a creator; new rows get the acting user.
ALTER TABLE "Transaction"   ADD COLUMN "createdById" TEXT;
ALTER TABLE "Rule"          ADD COLUMN "createdById" TEXT;
ALTER TABLE "Budget"        ADD COLUMN "createdById" TEXT;
ALTER TABLE "SavingsGoal"   ADD COLUMN "createdById" TEXT;
ALTER TABLE "RecurringRule" ADD COLUMN "createdById" TEXT;

UPDATE "Transaction"   t SET "createdById" = h."ownerId" FROM "Household" h WHERE h."id" = t."householdId";
UPDATE "Rule"          t SET "createdById" = h."ownerId" FROM "Household" h WHERE h."id" = t."householdId";
UPDATE "Budget"        t SET "createdById" = h."ownerId" FROM "Household" h WHERE h."id" = t."householdId";
UPDATE "SavingsGoal"   t SET "createdById" = h."ownerId" FROM "Household" h WHERE h."id" = t."householdId";
UPDATE "RecurringRule" t SET "createdById" = h."ownerId" FROM "Household" h WHERE h."id" = t."householdId";

-- 6. Credentials now live on Household, so drop them from User.
ALTER TABLE "User" DROP COLUMN "aiApiKey",
DROP COLUMN "aiModel",
DROP COLUMN "aiProvider",
DROP COLUMN "apiTokenCreatedAt",
DROP COLUMN "apiTokenSelector",
DROP COLUMN "apiTokenVerifierHash",
DROP COLUMN "plaidClientId",
DROP COLUMN "plaidEnv",
DROP COLUMN "plaidSecret";

-- 7. Rebuild indexes and foreign keys against Household.
-- CreateIndex
CREATE INDEX "Attachment_householdId_idx" ON "Attachment"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "BackupConfig_householdId_key" ON "BackupConfig"("householdId");

-- CreateIndex
CREATE INDEX "Budget_householdId_idx" ON "Budget"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "Budget_householdId_categoryId_month_key" ON "Budget"("householdId", "categoryId", "month");

-- CreateIndex
CREATE INDEX "Category_householdId_idx" ON "Category"("householdId");

-- CreateIndex
CREATE INDEX "Contribution_householdId_date_idx" ON "Contribution"("householdId", "date");

-- CreateIndex
CREATE INDEX "ContributionSchedule_householdId_idx" ON "ContributionSchedule"("householdId");

-- CreateIndex
CREATE INDEX "EmployerMatch_householdId_idx" ON "EmployerMatch"("householdId");

-- CreateIndex
CREATE INDEX "FinancialAccount_householdId_idx" ON "FinancialAccount"("householdId");

-- CreateIndex
CREATE INDEX "PlaidItem_householdId_idx" ON "PlaidItem"("householdId");

-- CreateIndex
CREATE INDEX "RecurringRule_householdId_idx" ON "RecurringRule"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "RetirementPlan_householdId_key" ON "RetirementPlan"("householdId");

-- CreateIndex
CREATE INDEX "Rule_householdId_idx" ON "Rule"("householdId");

-- CreateIndex
CREATE INDEX "RuleRun_householdId_createdAt_idx" ON "RuleRun"("householdId", "createdAt");

-- CreateIndex
CREATE INDEX "SavingsGoal_householdId_idx" ON "SavingsGoal"("householdId");

-- CreateIndex
CREATE INDEX "Tag_householdId_idx" ON "Tag"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_householdId_name_key" ON "Tag"("householdId", "name");

-- CreateIndex
CREATE INDEX "Transaction_householdId_date_idx" ON "Transaction"("householdId", "date");

-- CreateIndex
CREATE INDEX "Transaction_householdId_deletedAt_idx" ON "Transaction"("householdId", "deletedAt");

-- CreateIndex
CREATE INDEX "YtdContribution_householdId_year_idx" ON "YtdContribution"("householdId", "year");

-- CreateIndex
CREATE UNIQUE INDEX "YtdContribution_householdId_year_financialAccountId_source_key" ON "YtdContribution"("householdId", "year", "financialAccountId", "source");

-- AddForeignKey
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Category" ADD CONSTRAINT "Category_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RuleRun" ADD CONSTRAINT "RuleRun_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaidItem" ADD CONSTRAINT "PlaidItem_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BackupConfig" ADD CONSTRAINT "BackupConfig_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Tag" ADD CONSTRAINT "Tag_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RetirementPlan" ADD CONSTRAINT "RetirementPlan_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionSchedule" ADD CONSTRAINT "ContributionSchedule_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YtdContribution" ADD CONSTRAINT "YtdContribution_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerMatch" ADD CONSTRAINT "EmployerMatch_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

