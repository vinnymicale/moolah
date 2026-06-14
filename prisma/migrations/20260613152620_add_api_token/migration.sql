-- Read-only data API token stored as a selector/verifier pair: a non-secret
-- selector for indexed lookup plus a slow (scrypt) hash of the secret verifier.
ALTER TABLE "User" ADD COLUMN "apiTokenSelector" TEXT;
ALTER TABLE "User" ADD COLUMN "apiTokenVerifierHash" TEXT;
ALTER TABLE "User" ADD COLUMN "apiTokenCreatedAt" TIMESTAMP(3);
CREATE UNIQUE INDEX "User_apiTokenSelector_key" ON "User"("apiTokenSelector");
