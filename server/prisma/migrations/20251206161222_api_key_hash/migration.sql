/*
  Warnings:

  - You are about to drop the column `apiKey` on the `GameServer` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "GameServer" DROP COLUMN "apiKey",
ADD COLUMN     "apiKeyHash" TEXT;
