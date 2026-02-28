CREATE TABLE "GeoIpCache" (
    "ip" TEXT NOT NULL,
    "country" TEXT,
    "state" TEXT,
    "city" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "source" TEXT,
    "lastLookupAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextRetryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeoIpCache_pkey" PRIMARY KEY ("ip")
);

CREATE INDEX "GeoIpCache_expiresAt_idx" ON "GeoIpCache"("expiresAt");
CREATE INDEX "GeoIpCache_nextRetryAt_idx" ON "GeoIpCache"("nextRetryAt");
CREATE INDEX "GeoIpCache_updatedAt_idx" ON "GeoIpCache"("updatedAt");

