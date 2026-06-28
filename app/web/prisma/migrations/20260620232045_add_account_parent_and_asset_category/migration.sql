-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AccountCategory" ADD VALUE 'ASSET';
ALTER TYPE "AccountCategory" ADD VALUE 'LIABILITY';

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "parentId" INTEGER;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
