-- Soft delete for transactions: deleted rows are hidden everywhere but retained
-- so they can be restored from the trash, and so a re-imported Plaid charge is
-- matched on plaidTransactionId rather than duplicated.
ALTER TABLE "Transaction" ADD COLUMN "deletedAt" TIMESTAMP(3);

CREATE INDEX "Transaction_userId_deletedAt_idx" ON "Transaction"("userId", "deletedAt");
