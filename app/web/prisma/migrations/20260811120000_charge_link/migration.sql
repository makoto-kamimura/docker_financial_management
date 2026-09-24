-- チャージ（デビット・プリペイド・電子マネーへの資金移動）を「元の明細」と「チャージ先の入金明細」で
-- 対にできるようにする。
--
-- 背景: これまでチャージは元の明細に transferToAccountId（チャージ先のカード）を持たせるだけで、
-- チャージ先に入った記録とは結び付いていなかった。チャージ先の CSV に入金行が含まれる場合、
-- どの入金がどのチャージなのか分からず、入金行を科目に紐付けて収入として二重計上する余地が残る。
--
-- 対応:
--   * card_transactions.chargeGroupId … チャージ元と入金先の明細を対にする UUID。
--     bank_transactions.transferGroupId（口座間振替）と同じ考え方で、この値を持つ行は
--     どちら側も科目紐付け・実績転記の対象外にする。
--   * bank_transactions.chargeToAccountId … 銀行からデビット・プリペイド・電子マネーへの
--     チャージの場合のチャージ先（card_transactions.transferToAccountId の銀行版）。
--   * bank_transactions.chargeGroupId … 上と同じ ID 空間。銀行明細とカード明細の組になる。
--
-- いずれも既定は NULL なので、移行時点の表示・集計は変わらない。

-- AlterTable
ALTER TABLE "card_transactions" ADD COLUMN "chargeGroupId" TEXT;

-- CreateIndex
CREATE INDEX "card_transactions_chargeGroupId_idx" ON "card_transactions"("chargeGroupId");

-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN "chargeToAccountId" INTEGER;
ALTER TABLE "bank_transactions" ADD COLUMN "chargeGroupId" TEXT;

-- CreateIndex
CREATE INDEX "bank_transactions_chargeToAccountId_idx" ON "bank_transactions"("chargeToAccountId");

-- CreateIndex
CREATE INDEX "bank_transactions_chargeGroupId_idx" ON "bank_transactions"("chargeGroupId");

-- AddForeignKey
ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_chargeToAccountId_fkey"
  FOREIGN KEY ("chargeToAccountId") REFERENCES "linked_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
