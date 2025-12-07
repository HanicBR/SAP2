-- AlterTable
ALTER TABLE "GameServer" ADD COLUMN     "currentMap" TEXT,
ADD COLUMN     "lastHeartbeat" TIMESTAMP(3);
