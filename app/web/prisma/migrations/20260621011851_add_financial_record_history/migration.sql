-- CreateTable
CREATE TABLE "financial_record_histories" (
    "id" SERIAL NOT NULL,
    "recordId" INTEGER NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "financial_record_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "financial_record_histories_recordId_idx" ON "financial_record_histories"("recordId");

-- AddForeignKey
ALTER TABLE "financial_record_histories" ADD CONSTRAINT "financial_record_histories_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "financial_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;
