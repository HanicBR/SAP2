ALTER TABLE "User"
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3);

CREATE TYPE "UserEmailTokenType" AS ENUM ('EMAIL_VERIFY', 'PASSWORD_RESET');

CREATE TABLE "UserEmailToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "UserEmailTokenType" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserEmailToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserEmailToken_tokenHash_key" ON "UserEmailToken"("tokenHash");
CREATE INDEX "UserEmailToken_userId_type_createdAt_idx" ON "UserEmailToken"("userId", "type", "createdAt");
CREATE INDEX "UserEmailToken_type_expiresAt_idx" ON "UserEmailToken"("type", "expiresAt");

ALTER TABLE "UserEmailToken"
ADD CONSTRAINT "UserEmailToken_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
