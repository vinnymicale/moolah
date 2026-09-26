-- CreateEnum
CREATE TYPE "RewardCurrency" AS ENUM ('CASH', 'POINTS', 'MILES');

-- CreateTable
CREATE TABLE "CardRewardProfile" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "catalogCardId" TEXT,
    "currency" "RewardCurrency" NOT NULL DEFAULT 'CASH',
    "programName" TEXT,
    "centsPerPoint" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "baseRate" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "rules" JSONB NOT NULL DEFAULT '[]',
    "rotating" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardRewardProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CardCapProgress" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "profileId" TEXT NOT NULL,
    "capKey" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "spent" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "activated" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CardCapProgress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CardRewardProfile_financialAccountId_key" ON "CardRewardProfile"("financialAccountId");

-- CreateIndex
CREATE INDEX "CardRewardProfile_householdId_idx" ON "CardRewardProfile"("householdId");

-- CreateIndex
CREATE INDEX "CardCapProgress_householdId_idx" ON "CardCapProgress"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "CardCapProgress_profileId_capKey_periodStart_key" ON "CardCapProgress"("profileId", "capKey", "periodStart");

-- AddForeignKey
ALTER TABLE "CardRewardProfile" ADD CONSTRAINT "CardRewardProfile_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardRewardProfile" ADD CONSTRAINT "CardRewardProfile_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardCapProgress" ADD CONSTRAINT "CardCapProgress_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CardCapProgress" ADD CONSTRAINT "CardCapProgress_profileId_fkey" FOREIGN KEY ("profileId") REFERENCES "CardRewardProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;

