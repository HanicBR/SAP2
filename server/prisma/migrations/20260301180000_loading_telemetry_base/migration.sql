-- Loading screen telemetry foundation (sessions + batch events)
CREATE TYPE "LoadingTelemetryEventType" AS ENUM (
  'SESSION_START',
  'HEARTBEAT',
  'STATUS_CHANGE',
  'FILE_DOWNLOAD',
  'STAGE_MARK',
  'SESSION_END'
);

CREATE TABLE "LoadingTelemetrySession" (
  "id" TEXT NOT NULL,
  "sessionKey" TEXT NOT NULL,
  "slug" TEXT NOT NULL,
  "source" TEXT,
  "startedAt" TIMESTAMP(3) NOT NULL,
  "firstEventAt" TIMESTAMP(3),
  "lastEventAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "totalDurationMs" INTEGER,
  "lastStatus" TEXT,
  "lastFile" TEXT,
  "maxProgress" INTEGER,
  "userAgent" TEXT,
  "ipHash" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoadingTelemetrySession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LoadingTelemetryEvent" (
  "id" TEXT NOT NULL,
  "sessionId" TEXT NOT NULL,
  "seq" INTEGER NOT NULL,
  "type" "LoadingTelemetryEventType" NOT NULL,
  "eventAt" TIMESTAMP(3) NOT NULL,
  "statusText" TEXT,
  "fileName" TEXT,
  "progressPct" INTEGER,
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "LoadingTelemetryEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LoadingTelemetrySession_sessionKey_key" ON "LoadingTelemetrySession"("sessionKey");
CREATE INDEX "LoadingTelemetrySession_slug_startedAt_idx" ON "LoadingTelemetrySession"("slug", "startedAt");
CREATE INDEX "LoadingTelemetrySession_slug_createdAt_idx" ON "LoadingTelemetrySession"("slug", "createdAt");
CREATE INDEX "LoadingTelemetrySession_completed_startedAt_idx" ON "LoadingTelemetrySession"("completed", "startedAt");

CREATE UNIQUE INDEX "LoadingTelemetryEvent_sessionId_seq_key" ON "LoadingTelemetryEvent"("sessionId", "seq");
CREATE INDEX "LoadingTelemetryEvent_sessionId_eventAt_idx" ON "LoadingTelemetryEvent"("sessionId", "eventAt");
CREATE INDEX "LoadingTelemetryEvent_type_eventAt_idx" ON "LoadingTelemetryEvent"("type", "eventAt");

ALTER TABLE "LoadingTelemetryEvent"
ADD CONSTRAINT "LoadingTelemetryEvent_sessionId_fkey"
FOREIGN KEY ("sessionId") REFERENCES "LoadingTelemetrySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;