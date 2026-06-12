-- Single-user refactor: drop the Household layer and scope all financial data
-- directly to a User. Data-preserving: each household's rows are reassigned to
-- the household's earliest member, and the household's AI config moves to that
-- user. Rows belonging to a household with no members are unreachable in the
-- app and are removed.

-- AI assistant config now lives on the user.
ALTER TABLE "User" ADD COLUMN "aiProvider" TEXT;
ALTER TABLE "User" ADD COLUMN "aiApiKey" TEXT;

-- Map each household to its earliest member.
CREATE TEMPORARY TABLE "household_owner" AS
SELECT DISTINCT ON ("householdId") "householdId", "id" AS "userId"
FROM "User"
WHERE "householdId" IS NOT NULL
ORDER BY "householdId", "createdAt" ASC, "id" ASC;

-- Carry the AI config over to the owning user.
UPDATE "User" u
SET "aiProvider" = h."aiProvider", "aiApiKey" = h."aiApiKey"
FROM "household_owner" o
JOIN "Household" h ON h."id" = o."householdId"
WHERE u."id" = o."userId";

-- FinancialAccount
ALTER TABLE "FinancialAccount" ADD COLUMN "userId" TEXT;
UPDATE "FinancialAccount" t SET "userId" = o."userId" FROM "household_owner" o WHERE t."householdId" = o."householdId";
DELETE FROM "FinancialAccount" WHERE "userId" IS NULL;
ALTER TABLE "FinancialAccount" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "FinancialAccount" DROP COLUMN "householdId";
ALTER TABLE "FinancialAccount" ADD CONSTRAINT "FinancialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "FinancialAccount_userId_idx" ON "FinancialAccount"("userId");

-- Category
ALTER TABLE "Category" ADD COLUMN "userId" TEXT;
UPDATE "Category" t SET "userId" = o."userId" FROM "household_owner" o WHERE t."householdId" = o."householdId";
DELETE FROM "Category" WHERE "userId" IS NULL;
ALTER TABLE "Category" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Category" DROP COLUMN "householdId";
ALTER TABLE "Category" ADD CONSTRAINT "Category_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Category_userId_idx" ON "Category"("userId");

-- CategoryRule
ALTER TABLE "CategoryRule" ADD COLUMN "userId" TEXT;
UPDATE "CategoryRule" t SET "userId" = o."userId" FROM "household_owner" o WHERE t."householdId" = o."householdId";
DELETE FROM "CategoryRule" WHERE "userId" IS NULL;
ALTER TABLE "CategoryRule" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "CategoryRule" DROP COLUMN "householdId";
ALTER TABLE "CategoryRule" ADD CONSTRAINT "CategoryRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "CategoryRule_userId_idx" ON "CategoryRule"("userId");

-- Transaction (also drops the multi-user "created by" attribution)
ALTER TABLE "Transaction" ADD COLUMN "userId" TEXT;
UPDATE "Transaction" t SET "userId" = o."userId" FROM "household_owner" o WHERE t."householdId" = o."householdId";
DELETE FROM "Transaction" WHERE "userId" IS NULL;
ALTER TABLE "Transaction" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Transaction" DROP COLUMN "householdId";
ALTER TABLE "Transaction" DROP COLUMN "createdById";
ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Transaction_userId_date_idx" ON "Transaction"("userId", "date");

-- RecurringRule
ALTER TABLE "RecurringRule" ADD COLUMN "userId" TEXT;
UPDATE "RecurringRule" t SET "userId" = o."userId" FROM "household_owner" o WHERE t."householdId" = o."householdId";
DELETE FROM "RecurringRule" WHERE "userId" IS NULL;
ALTER TABLE "RecurringRule" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "RecurringRule" DROP COLUMN "householdId";
ALTER TABLE "RecurringRule" ADD CONSTRAINT "RecurringRule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "RecurringRule_userId_idx" ON "RecurringRule"("userId");

-- Budget
ALTER TABLE "Budget" ADD COLUMN "userId" TEXT;
UPDATE "Budget" t SET "userId" = o."userId" FROM "household_owner" o WHERE t."householdId" = o."householdId";
DELETE FROM "Budget" WHERE "userId" IS NULL;
ALTER TABLE "Budget" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "Budget" DROP COLUMN "householdId";
ALTER TABLE "Budget" ADD CONSTRAINT "Budget_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "Budget_userId_idx" ON "Budget"("userId");
CREATE UNIQUE INDEX "Budget_userId_categoryId_month_key" ON "Budget"("userId", "categoryId", "month");

-- SavingsGoal
ALTER TABLE "SavingsGoal" ADD COLUMN "userId" TEXT;
UPDATE "SavingsGoal" t SET "userId" = o."userId" FROM "household_owner" o WHERE t."householdId" = o."householdId";
DELETE FROM "SavingsGoal" WHERE "userId" IS NULL;
ALTER TABLE "SavingsGoal" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "SavingsGoal" DROP COLUMN "householdId";
ALTER TABLE "SavingsGoal" ADD CONSTRAINT "SavingsGoal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "SavingsGoal_userId_idx" ON "SavingsGoal"("userId");

-- PlaidItem
ALTER TABLE "PlaidItem" ADD COLUMN "userId" TEXT;
UPDATE "PlaidItem" t SET "userId" = o."userId" FROM "household_owner" o WHERE t."householdId" = o."householdId";
DELETE FROM "PlaidItem" WHERE "userId" IS NULL;
ALTER TABLE "PlaidItem" ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "PlaidItem" DROP COLUMN "householdId";
ALTER TABLE "PlaidItem" ADD CONSTRAINT "PlaidItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "PlaidItem_userId_idx" ON "PlaidItem"("userId");

-- Finally, drop the household linkage and the table itself.
ALTER TABLE "User" DROP COLUMN "householdId";
DROP TABLE "Household";

DROP TABLE "household_owner";
