-- Add per-player VIP server scope (empty array means all servers)
ALTER TABLE "PlayerProfile"
ADD COLUMN "vipServerIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
