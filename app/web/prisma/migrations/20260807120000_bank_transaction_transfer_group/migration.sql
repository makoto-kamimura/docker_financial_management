-- 銀行から銀行への資金移動（都度の振替）を明細として登録できるようにする。
--
-- 背景: 毎月の固定ルール（transfers）は口座間振替を表現できるが、都度の振替を実績として
-- 登録する手段が無かった。片方の口座に手入力しても相手口座には反映されず残高がずれる。
-- また振替を科目（categoryAccountId）に紐付けると収入・支出として二重計上されてしまう。
--
-- 対応: 1 回の振替を「出金元に −amount / 入金先に +amount」の 2 行で表し、
-- transferGroupId（UUID）で対にする。この列を持つ行は科目紐付け・実績転記の対象外とし、
-- 未紐付けのまま残すことで資金フロー図・実績転記の集計から自然に外れる（残高だけが動く）。

-- AlterTable
ALTER TABLE "bank_transactions" ADD COLUMN "transferGroupId" TEXT;

-- CreateIndex（対になる相手行の検索用。片方を削除したらもう片方も消す）
CREATE INDEX "bank_transactions_transferGroupId_idx" ON "bank_transactions"("transferGroupId");
