-- Marks a duplicate group the user reviewed and accepted as legitimate (two
-- identical charges that both really happened). Set on every row of the group;
-- the dedup scan skips a group only when all of its rows carry this, so a
-- genuinely new copy - which arrives unflagged - still surfaces for review.
ALTER TABLE "Transaction" ADD COLUMN "dedupIgnored" BOOLEAN NOT NULL DEFAULT false;
