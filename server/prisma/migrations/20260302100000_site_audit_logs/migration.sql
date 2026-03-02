-- CreateTable
CREATE TABLE "SiteAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT,
    "userRole" "UserRole",
    "action" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "statusCode" INTEGER NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteAuditLog_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "SiteAuditLog" ADD CONSTRAINT "SiteAuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "SiteAuditLog_createdAt_idx" ON "SiteAuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "SiteAuditLog_userId_createdAt_idx" ON "SiteAuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "SiteAuditLog_action_createdAt_idx" ON "SiteAuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "SiteAuditLog_method_createdAt_idx" ON "SiteAuditLog"("method", "createdAt");
