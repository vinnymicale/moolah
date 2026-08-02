-- CreateTable
CREATE TABLE "YtdContribution" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "source" "ContributionSource" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "YtdContribution_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "YtdContribution_userId_year_idx" ON "YtdContribution"("userId", "year");

-- CreateIndex
CREATE INDEX "YtdContribution_financialAccountId_idx" ON "YtdContribution"("financialAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "YtdContribution_userId_year_financialAccountId_source_key" ON "YtdContribution"("userId", "year", "financialAccountId", "source");

-- AddForeignKey
ALTER TABLE "YtdContribution" ADD CONSTRAINT "YtdContribution_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "YtdContribution" ADD CONSTRAINT "YtdContribution_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "FinancialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
