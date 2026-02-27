DO $$
BEGIN
    CREATE TYPE "VipAutomationActionType" AS ENUM ('GRANT', 'REVOKE');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
    CREATE TYPE "VipAutomationActionStatus" AS ENUM ('QUEUED', 'FAILED', 'SKIPPED');
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS "VipAutomationAction" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" "VipAutomationActionType" NOT NULL,
    "status" "VipAutomationActionStatus" NOT NULL,
    "steamId" TEXT NOT NULL,
    "vipPlan" TEXT,
    "vipExpiry" TIMESTAMP(3),
    "serverId" TEXT,
    "command" TEXT,
    "metadata" JSONB,
    "reason" TEXT,
    "queuedActionId" TEXT,
    "retryOfActionId" TEXT,
    "retriedAt" TIMESTAMP(3),
    "retries" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "VipAutomationAction_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "VipAutomationAction_createdAt_idx" ON "VipAutomationAction"("createdAt");
CREATE INDEX IF NOT EXISTS "VipAutomationAction_steamId_createdAt_idx" ON "VipAutomationAction"("steamId", "createdAt");
CREATE INDEX IF NOT EXISTS "VipAutomationAction_status_createdAt_idx" ON "VipAutomationAction"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "VipAutomationAction_retryOfActionId_idx" ON "VipAutomationAction"("retryOfActionId");
