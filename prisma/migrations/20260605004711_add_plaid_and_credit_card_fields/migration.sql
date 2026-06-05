-- AlterTable
ALTER TABLE "FinancialAccount" ADD COLUMN     "creditLimit" DECIMAL(14,2),
ADD COLUMN     "includeInDebtPlanner" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "includeInNetWorth" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "interestRate" DECIMAL(6,3),
ADD COLUMN     "isOverdue" BOOLEAN,
ADD COLUMN     "lastPaymentAmount" DECIMAL(14,2),
ADD COLUMN     "lastPaymentDate" TIMESTAMP(3),
ADD COLUMN     "lastStatementBalance" DECIMAL(14,2),
ADD COLUMN     "lastStatementDate" TIMESTAMP(3),
ADD COLUMN     "minimumPayment" DECIMAL(14,2),
ADD COLUMN     "nextPaymentDueDate" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "plaidDetailedCategory" TEXT,
ADD COLUMN     "plaidPrimaryCategory" TEXT,
ADD COLUMN     "plaidTransactionId" TEXT;

-- CreateTable
CREATE TABLE "PlaidItem" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "accessToken" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "institutionId" TEXT,
    "institutionName" TEXT,
    "cursor" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaidItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlaidLinkedAccount" (
    "id" TEXT NOT NULL,
    "plaidItemId" TEXT NOT NULL,
    "plaidAccountId" TEXT NOT NULL,
    "financialAccountId" TEXT,
    "name" TEXT NOT NULL,
    "officialName" TEXT,
    "mask" TEXT,
    "plaidType" TEXT NOT NULL,
    "plaidSubtype" TEXT,
    "availableBalance" DECIMAL(14,2),
    "currentBalance" DECIMAL(14,2),
    "creditLimit" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlaidLinkedAccount_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlaidItem_itemId_key" ON "PlaidItem"("itemId");

-- CreateIndex
CREATE INDEX "PlaidItem_householdId_idx" ON "PlaidItem"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "PlaidLinkedAccount_plaidAccountId_key" ON "PlaidLinkedAccount"("plaidAccountId");

-- CreateIndex
CREATE INDEX "PlaidLinkedAccount_plaidItemId_idx" ON "PlaidLinkedAccount"("plaidItemId");

-- CreateIndex
CREATE UNIQUE INDEX "Transaction_plaidTransactionId_key" ON "Transaction"("plaidTransactionId");

-- AddForeignKey
ALTER TABLE "PlaidItem" ADD CONSTRAINT "PlaidItem_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaidLinkedAccount" ADD CONSTRAINT "PlaidLinkedAccount_plaidItemId_fkey" FOREIGN KEY ("plaidItemId") REFERENCES "PlaidItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlaidLinkedAccount" ADD CONSTRAINT "PlaidLinkedAccount_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

