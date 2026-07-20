-- D-5a: FinancialRecord に発生元仕訳（journalEntryId）への逆参照を追加する。
-- syncJournalToFinancialRecords() が生成した行のみ設定され、仕訳削除時にこの参照を辿って
-- 同期済み FinancialRecord 行を一緒に削除できるようにする（孤立行の発生を防ぐ）。
-- 既存行は仕訳との対応関係が追跡できないため NULL のまま据え置く（実害なし）。

ALTER TABLE "financial_records" ADD COLUMN "journalEntryId" INTEGER;

-- CreateIndex
CREATE INDEX "financial_records_journalEntryId_idx" ON "financial_records"("journalEntryId");

-- AddForeignKey
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;
