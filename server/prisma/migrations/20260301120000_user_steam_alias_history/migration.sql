-- Add steam identity fields to User
ALTER TABLE "User"
ADD COLUMN "steamId64" TEXT,
ADD COLUMN "steamProfileUrl" TEXT,
ADD COLUMN "steamAvatarUrl" TEXT,
ADD COLUMN "steamPersonaName" TEXT,
ADD COLUMN "steamLinkedAt" TIMESTAMP(3),
ADD COLUMN "steamLastSyncAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "User_steamId64_key" ON "User"("steamId64");

-- Track known aliases (nick history) per player
CREATE TABLE "PlayerAliasHistory" (
    "id" TEXT NOT NULL,
    "steamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlayerAliasHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerAliasHistory_steamId_name_key" ON "PlayerAliasHistory"("steamId", "name");
CREATE INDEX "PlayerAliasHistory_steamId_lastSeen_idx" ON "PlayerAliasHistory"("steamId", "lastSeen");
CREATE INDEX "PlayerAliasHistory_name_lastSeen_idx" ON "PlayerAliasHistory"("name", "lastSeen");

ALTER TABLE "PlayerAliasHistory"
ADD CONSTRAINT "PlayerAliasHistory_steamId_fkey"
FOREIGN KEY ("steamId") REFERENCES "PlayerProfile"("steamId") ON DELETE CASCADE ON UPDATE CASCADE;
