-- CreateTable
CREATE TABLE "PlayerPlaytimePulse" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "steamId" TEXT NOT NULL,
    "bucketStart" TIMESTAMP(3) NOT NULL,
    "grantedSeconds" INTEGER NOT NULL,
    "playerName" TEXT,
    "map" TEXT,
    "playerCount" INTEGER,
    "sentAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerPlaytimePulse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlayerPlaytimePulse_serverId_steamId_bucketStart_key" ON "PlayerPlaytimePulse"("serverId", "steamId", "bucketStart");

-- CreateIndex
CREATE INDEX "PlayerPlaytimePulse_serverId_bucketStart_idx" ON "PlayerPlaytimePulse"("serverId", "bucketStart");

-- CreateIndex
CREATE INDEX "PlayerPlaytimePulse_steamId_bucketStart_idx" ON "PlayerPlaytimePulse"("steamId", "bucketStart");

-- AddForeignKey
ALTER TABLE "PlayerPlaytimePulse" ADD CONSTRAINT "PlayerPlaytimePulse_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "GameServer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
