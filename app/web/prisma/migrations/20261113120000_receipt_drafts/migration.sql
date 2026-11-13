-- 仮の明細（レシートを撮ってすぐ保存し、読み取りはあとで進める現金の明細の下書き）
CREATE TYPE "ReceiptDraftStatus" AS ENUM ('READING', 'READ', 'FAILED');

CREATE TABLE "receipt_drafts" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "status" "ReceiptDraftStatus" NOT NULL DEFAULT 'READING',
    "draft" JSONB,
    "suggestedAccount" JSONB,
    "warnings" JSONB,
    "readDate" DATE,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "receipt_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "receipt_drafts_tenantId_date_idx" ON "receipt_drafts"("tenantId", "date");
CREATE INDEX "receipt_drafts_tenantId_readDate_idx" ON "receipt_drafts"("tenantId", "readDate");

-- 仮の明細の写真（登録すると明細に付け替える）
ALTER TABLE "receipts" ADD COLUMN "receiptDraftId" INTEGER;
CREATE INDEX "receipts_receiptDraftId_idx" ON "receipts"("receiptDraftId");
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_receiptDraftId_fkey" FOREIGN KEY ("receiptDraftId") REFERENCES "receipt_drafts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 証憑は仕訳・現金の明細・仮の明細のどれか一つに付く（両方・どれも無しは拒否する）
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_one_owner";
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_one_owner"
  CHECK (num_nonnulls("journalEntryId", "financialRecordId", "receiptDraftId") = 1);
