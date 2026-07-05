-- DropIndex
DROP INDEX "users_tenantId_key";

-- CreateIndex
CREATE INDEX "users_tenantId_idx" ON "users"("tenantId");
