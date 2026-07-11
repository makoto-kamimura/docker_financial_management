-- CreateEnum
CREATE TYPE "PersonalAssetCategory" AS ENUM ('LAND', 'BUILDING', 'VEHICLE', 'GOLD', 'OTHER');

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "linkedAccountId" INTEGER,
ADD COLUMN     "loanType" TEXT NOT NULL DEFAULT 'business',
ADD COLUMN     "monthlyPayment" DECIMAL(18,2);

-- CreateTable
CREATE TABLE "personal_assets" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PersonalAssetCategory" NOT NULL DEFAULT 'OTHER',
    "acquiredOn" TIMESTAMP(3),
    "acquisitionCost" DECIMAL(18,2),
    "currentValue" DECIMAL(18,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_assets_tenantId_idx" ON "personal_assets"("tenantId");

-- CreateIndex
CREATE INDEX "loans_linkedAccountId_idx" ON "loans"("linkedAccountId");

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_linkedAccountId_fkey" FOREIGN KEY ("linkedAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

