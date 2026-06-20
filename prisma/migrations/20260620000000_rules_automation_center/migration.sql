-- Rules & automation center: replace the flat CategoryRule (pattern -> category)
-- with a richer Rule (AND'd conditions + multiple actions, stored as JSON).
-- Existing CategoryRule rows are migrated forward as a single
-- "description contains" condition + "set category" action so nothing is lost.

CREATE TABLE "Rule" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "conditions" JSONB NOT NULL,
    "actions" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Rule_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Rule_userId_idx" ON "Rule"("userId");

ALTER TABLE "Rule" ADD CONSTRAINT "Rule_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry existing rules over. Ids only need to be unique (the app never parses
-- them as cuids), so a random uuid is fine for migrated rows. ROW_NUMBER gives a
-- stable priority that preserves the old creation order per user.
INSERT INTO "Rule" ("id", "userId", "name", "enabled", "priority", "conditions", "actions", "createdAt", "updatedAt")
SELECT
    gen_random_uuid()::text,
    "userId",
    NULL,
    true,
    (ROW_NUMBER() OVER (PARTITION BY "userId" ORDER BY "createdAt") - 1)::int,
    jsonb_build_array(jsonb_build_object('type', 'descriptionContains', 'value', "pattern")),
    jsonb_build_array(jsonb_build_object('type', 'setCategory', 'categoryId', "categoryId")),
    "createdAt",
    CURRENT_TIMESTAMP
FROM "CategoryRule";

DROP TABLE "CategoryRule";
