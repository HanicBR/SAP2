CREATE TABLE "PlayerIpHistory" (
    "steamId" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "firstSeen" TIMESTAMP(3) NOT NULL,
    "lastSeen" TIMESTAMP(3) NOT NULL,
    "connections" INTEGER NOT NULL DEFAULT 0,
    "lastServerId" TEXT,
    "geoSnapshot" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerIpHistory_pkey" PRIMARY KEY ("steamId","ip")
);

CREATE INDEX "PlayerIpHistory_steamId_lastSeen_idx" ON "PlayerIpHistory"("steamId", "lastSeen");
CREATE INDEX "PlayerIpHistory_ip_lastSeen_idx" ON "PlayerIpHistory"("ip", "lastSeen");

ALTER TABLE "PlayerIpHistory"
ADD CONSTRAINT "PlayerIpHistory_steamId_fkey"
FOREIGN KEY ("steamId") REFERENCES "PlayerProfile"("steamId")
ON DELETE CASCADE ON UPDATE CASCADE;

