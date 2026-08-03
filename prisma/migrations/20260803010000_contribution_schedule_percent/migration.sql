-- CreateEnum
CREATE TYPE "ContributionBasis" AS ENUM ('AMOUNT', 'PERCENT_OF_SALARY');

-- AlterTable
ALTER TABLE "ContributionSchedule" ADD COLUMN "basis" "ContributionBasis" NOT NULL DEFAULT 'AMOUNT',
ADD COLUMN "percentOfSalary" DECIMAL(5,2),
ALTER COLUMN "amount" DROP NOT NULL;
