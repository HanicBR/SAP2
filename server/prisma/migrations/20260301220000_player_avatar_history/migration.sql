CREATE TABLE "PlayerAvatarHistory" (
    "id" TEXT NOT NULL,
    "steamId" TEXT NOT NULL,
    "avatarUrl" TEXT NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "seenCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerAvatarHistory_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlayerAvatarHistory_steamId_avatarUrl_key" ON "PlayerAvatarHistory"("steamId", "avatarUrl");
CREATE INDEX "PlayerAvatarHistory_steamId_lastSeen_idx" ON "PlayerAvatarHistory"("steamId", "lastSeen");

ALTER TABLE "PlayerAvatarHistory"
ADD CONSTRAINT "PlayerAvatarHistory_steamId_fkey"
FOREIGN KEY ("steamId") REFERENCES "PlayerProfile"("steamId") ON DELETE CASCADE ON UPDATE CASCADE;
