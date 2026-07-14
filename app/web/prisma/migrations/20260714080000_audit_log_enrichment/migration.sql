-- AlterTable
ALTER TABLE "audit_logs" ADD COLUMN     "ip" TEXT,
ADD COLUMN     "tenantId" INTEGER,
ADD COLUMN     "userAgent" TEXT;

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_changedAt_idx" ON "audit_logs"("tenantId", "changedAt");

-- CreateIndex
CREATE INDEX "audit_logs_userId_changedAt_idx" ON "audit_logs"("userId", "changedAt");

