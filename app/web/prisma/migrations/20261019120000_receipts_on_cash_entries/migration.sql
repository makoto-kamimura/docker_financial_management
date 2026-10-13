-- 証憑を現金の明細にも付けられるようにする（レシートの撮影で読み取った写真）。
--   - 証憑は仕訳か現金の明細のどちらか一方に付く（両方・どちらも無しは CHECK 制約で拒否する）
--   - 明細を消すと、その証憑の行も消える

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "financialRecordId" INTEGER,
ALTER COLUMN "journalEntryId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "receipts_financialRecordId_idx" ON "receipts"("financialRecordId");

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_financialRecordId_fkey" FOREIGN KEY ("financialRecordId") REFERENCES "financial_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;


ALTER TABLE "receipts" ADD CONSTRAINT "receipts_one_owner"
  CHECK (num_nonnulls("journalEntryId", "financialRecordId") = 1);
