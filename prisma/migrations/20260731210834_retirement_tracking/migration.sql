-- CreateEnum
CREATE TYPE "ContributionSource" AS ENUM ('EMPLOYEE_PRETAX', 'EMPLOYEE_ROTH', 'EMPLOYER_MATCH', 'AFTER_TAX', 'ROLLOVER');

-- CreateTable
CREATE TABLE "RetirementPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "birthYear" INTEGER NOT NULL,
    "targetRetirementAge" INTEGER NOT NULL DEFAULT 65,
    "expectedReturn" DECIMAL(6,3) NOT NULL DEFAULT 7.0,
    "inflationRate" DECIMAL(6,3) NOT NULL DEFAULT 3.0,
    "incomeReplacementRatio" DECIMAL(6,3) NOT NULL DEFAULT 80.0,
    "safeWithdrawalRate" DECIMAL(6,3) NOT NULL DEFAULT 4.0,
    "expectedSocialSecurityMonthly" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "currentAnnualSalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RetirementPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contribution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "source" "ContributionSource" NOT NULL,
    "transactionId" TEXT,
    "scheduleId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContributionSchedule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "source" "ContributionSource" NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "interval" INTEGER NOT NULL DEFAULT 1,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3),
    "dayOfMonth" INTEGER,
    "weekday" INTEGER,
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContributionSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployerMatch" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "tiers" JSONB NOT NULL,
    "annualCap" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployerMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RetirementPlan_userId_key" ON "RetirementPlan"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Contribution_transactionId_key" ON "Contribution"("transactionId");

-- CreateIndex
CREATE INDEX "Contribution_userId_date_idx" ON "Contribution"("userId", "date");

-- CreateIndex
CREATE INDEX "Contribution_financialAccountId_idx" ON "Contribution"("financialAccountId");

-- CreateIndex
CREATE INDEX "ContributionSchedule_userId_idx" ON "ContributionSchedule"("userId");

-- CreateIndex
CREATE INDEX "ContributionSchedule_financialAccountId_idx" ON "ContributionSchedule"("financialAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "EmployerMatch_financialAccountId_key" ON "EmployerMatch"("financialAccountId");

-- CreateIndex
CREATE INDEX "EmployerMatch_userId_idx" ON "EmployerMatch"("userId");

-- AddForeignKey
ALTER TABLE "RetirementPlan" ADD CONSTRAINT "RetirementPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "Transaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Contribution" ADD CONSTRAINT "Contribution_scheduleId_fkey" FOREIGN KEY ("scheduleId") REFERENCES "ContributionSchedule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionSchedule" ADD CONSTRAINT "ContributionSchedule_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContributionSchedule" ADD CONSTRAINT "ContributionSchedule_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerMatch" ADD CONSTRAINT "EmployerMatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployerMatch" ADD CONSTRAINT "EmployerMatch_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
