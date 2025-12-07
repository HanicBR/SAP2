-- Add mustChangePassword flag to users to control first login password reset
ALTER TABLE "User"
ADD COLUMN "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;
