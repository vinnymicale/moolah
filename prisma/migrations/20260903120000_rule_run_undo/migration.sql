-- Record each "Apply to existing" run and the prior values of every field it
-- changed, so the run can be undone rather than reverse-engineered.

CREATE TABLE "RuleRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "ruleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoneAt" TIMESTAMP(3),

    CONSTRAINT "RuleRun_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RuleRunChange" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "hadDescription" BOOLEAN NOT NULL DEFAULT false,
    "prevDescription" TEXT,
    "hadCategory" BOOLEAN NOT NULL DEFAULT false,
    "prevCategoryId" TEXT,
    "hadTransfer" BOOLEAN NOT NULL DEFAULT false,
    "prevIsTransfer" BOOLEAN,
    "prevTransferPeerId" TEXT,
    "createdSplits" BOOLEAN NOT NULL DEFAULT false,
    "addedTagIds" TEXT[],

    CONSTRAINT "RuleRunChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RuleRun_userId_createdAt_idx" ON "RuleRun"("userId", "createdAt");
CREATE INDEX "RuleRunChange_runId_idx" ON "RuleRunChange"("runId");
CREATE INDEX "RuleRunChange_transactionId_idx" ON "RuleRunChange"("transactionId");

ALTER TABLE "RuleRun" ADD CONSTRAINT "RuleRun_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RuleRunChange" ADD CONSTRAINT "RuleRunChange_runId_fkey"
    FOREIGN KEY ("runId") REFERENCES "RuleRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
