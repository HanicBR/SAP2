-- CreateEnum
CREATE TYPE "PunishmentType" AS ENUM ('BAN', 'MUTE', 'GAG', 'KICK', 'WARN');

-- CreateTable
CREATE TABLE "Punishment" (
    "id" TEXT NOT NULL,
    "steamId" TEXT NOT NULL,
    "type" "PunishmentType" NOT NULL,
    "reason" TEXT NOT NULL,
    "staffName" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "duration" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Punishment_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Punishment" ADD CONSTRAINT "Punishment_steamId_fkey" FOREIGN KEY ("steamId") REFERENCES "PlayerProfile"("steamId") ON DELETE CASCADE ON UPDATE CASCADE;
