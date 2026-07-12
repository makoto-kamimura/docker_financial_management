-- AlterTable
ALTER TABLE "personal_assets" ADD COLUMN     "debtStartOn" TIMESTAMP(3),
ADD COLUMN     "debtPayoffDue" TIMESTAMP(3),
ADD COLUMN     "debtInitialAmount" DECIMAL(18,2);
