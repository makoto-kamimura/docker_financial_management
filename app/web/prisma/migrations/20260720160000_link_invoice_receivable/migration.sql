-- D-3: 請求と売掛のFKリンク
-- receivables.invoiceId を追加し、発行済みインボイスから自動生成された売掛金を示す。

ALTER TABLE "receivables" ADD COLUMN "invoiceId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "receivables_invoiceId_key" ON "receivables"("invoiceId");

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 既存の issued/paid インボイスのうち、invoiceNumber が一致する既存 receivables 行があれば
-- 手動での紐付けはせず null のまま残す（自動生成された組の判定は自動生成時のみ意味を持つため、
-- 過去データを誤って自動生成扱いにしないほうが安全）。新規発行分から本機能が適用される。
