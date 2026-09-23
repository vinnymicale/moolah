-- CreateEnum
CREATE TYPE "HouseholdRole" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "aiProvider" TEXT,
    "aiApiKey" TEXT,
    "aiModel" TEXT,
    "plaidClientId" TEXT,
    "plaidSecret" TEXT,
    "plaidEnv" TEXT,
    "apiTokenSelector" TEXT,
    "apiTokenVerifierHash" TEXT,
    "apiTokenCreatedAt" TIMESTAMP(3),

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "HouseholdRole" NOT NULL DEFAULT 'MEMBER',
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deniedCapabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "householdId" TEXT NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Household_apiTokenSelector_key" ON "Household"("apiTokenSelector");

-- CreateIndex
CREATE INDEX "Household_ownerId_idx" ON "Household"("ownerId");

-- CreateIndex
CREATE INDEX "HouseholdMember_householdId_idx" ON "HouseholdMember"("householdId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdMember_userId_key" ON "HouseholdMember"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "HouseholdMember_householdId_userId_key" ON "HouseholdMember"("householdId", "userId");

-- CreateIndex
CREATE INDEX "AuditLog_householdId_createdAt_idx" ON "AuditLog"("householdId", "createdAt");

-- AddForeignKey
ALTER TABLE "Household" ADD CONSTRAINT "Household_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
