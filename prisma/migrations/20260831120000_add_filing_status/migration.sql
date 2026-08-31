-- CreateEnum
CREATE TYPE "FilingStatus" AS ENUM ('SINGLE', 'MARRIED_JOINT', 'MARRIED_SEPARATE', 'HEAD_OF_HOUSEHOLD');

-- AlterTable
ALTER TABLE "RetirementPlan" ADD COLUMN "filingStatus" "FilingStatus" NOT NULL DEFAULT 'SINGLE';
