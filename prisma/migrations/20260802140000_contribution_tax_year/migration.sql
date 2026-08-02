-- AlterTable
-- Nullable so existing rows keep falling back to the deposit year.
ALTER TABLE "Contribution" ADD COLUMN "taxYear" INTEGER;
