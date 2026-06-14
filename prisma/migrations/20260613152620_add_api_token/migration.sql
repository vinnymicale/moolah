-- Read-only data API token: store only the SHA-256 hash of the random token.
ALTER TABLE "User" ADD COLUMN "apiTokenHash" TEXT;
ALTER TABLE "User" ADD COLUMN "apiTokenCreatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_apiTokenHash_key" ON "User"("apiTokenHash");
