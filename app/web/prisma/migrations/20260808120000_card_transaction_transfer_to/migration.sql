-- カード明細の「チャージ（他カード・電子マネーへの資金移動）」を収支の対象外にする。
--
-- 背景: 三井住友カードの「[信] ＪＡＬ　Ｐａｙ」のようなチャージは、それ自体が支出ではなく
-- JAL Global Wallet へ資金を移しているだけで、実際の支出はチャージ先の利用明細で計上される。
-- 両方を科目に紐付けると同じ支出が二重に計上される。銀行明細には同じ目的の transferGroupId が
-- あるが、カード明細には対象外にする手段が無かった。
--
-- 対応: チャージ先の LinkedAccount を指す transferToAccountId を追加する。この値を持つ行は
-- 銀行の transferGroupId と同じく科目紐付け・実績転記の対象外とし、明細一覧では「チャージ」
-- バッジを表示する。既定は NULL なので移行時点の表示・集計は変わらない。
--
-- あわせて card_transfer_rules を追加する。摘要キーワードから自動でチャージ判定するための
-- ルールで、明細一覧の一括操作で作られ、以後の CSV 取込にも適用される
-- （txn_category_rules が科目を自動で埋めるのと同じ位置付け）。

-- AlterTable
ALTER TABLE "card_transactions" ADD COLUMN "transferToAccountId" INTEGER;

-- CreateIndex
CREATE INDEX "card_transactions_transferToAccountId_idx" ON "card_transactions"("transferToAccountId");

-- AddForeignKey
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_transferToAccountId_fkey"
  FOREIGN KEY ("transferToAccountId") REFERENCES "linked_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "card_transfer_rules" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "keyword" TEXT NOT NULL,
    "transferToAccountId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_transfer_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "card_transfer_rules_accountId_keyword_key" ON "card_transfer_rules"("accountId", "keyword");

-- CreateIndex
CREATE INDEX "card_transfer_rules_tenantId_idx" ON "card_transfer_rules"("tenantId");

-- AddForeignKey
ALTER TABLE "card_transfer_rules" ADD CONSTRAINT "card_transfer_rules_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "linked_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_transfer_rules" ADD CONSTRAINT "card_transfer_rules_transferToAccountId_fkey"
  FOREIGN KEY ("transferToAccountId") REFERENCES "linked_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
