-- AlterTable
ALTER TABLE "personal_assets" ADD COLUMN     "linkedAccountId" INTEGER;

-- CreateIndex
CREATE INDEX "personal_assets_linkedAccountId_idx" ON "personal_assets"("linkedAccountId");

-- AddForeignKey
ALTER TABLE "personal_assets" ADD CONSTRAINT "personal_assets_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
