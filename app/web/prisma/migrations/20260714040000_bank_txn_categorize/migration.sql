-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN     "categoryAccountId" INTEGER,
ADD COLUMN     "postedRecordId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "bank_transactions_postedRecordId_key" ON "bank_transactions"("postedRecordId");

-- CreateIndex
CREATE INDEX "bank_transactions_categoryAccountId_idx" ON "bank_transactions"("categoryAccountId");

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_categoryAccountId_fkey" FOREIGN KEY ("categoryAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_postedRecordId_fkey" FOREIGN KEY ("postedRecordId") REFERENCES "financial_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

