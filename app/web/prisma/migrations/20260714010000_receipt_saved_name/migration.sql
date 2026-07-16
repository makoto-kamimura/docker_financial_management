-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "savedName" TEXT,
ADD COLUMN     "mimeType" TEXT;

-- データ移行: 既存 fileUrl（/api/uploads/<savedName>）から savedName を逆算する。
-- 旧レコードにも配信認可（savedName 一致 + journalEntry.tenantId）を適用できるようにする。
UPDATE "receipts"
SET "savedName" = regexp_replace("fileUrl", '^.*/', '')
WHERE "savedName" IS NULL AND "fileUrl" LIKE '/api/uploads/%';

-- CreateIndex
CREATE UNIQUE INDEX "receipts_savedName_key" ON "receipts"("savedName");
