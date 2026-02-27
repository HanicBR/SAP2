DO $$
BEGIN
    ALTER TYPE "LogType" ADD VALUE 'PUNISH';
EXCEPTION
    WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Log"
ADD COLUMN IF NOT EXISTS "eventId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "Log_serverId_eventId_key" ON "Log"("serverId", "eventId");
