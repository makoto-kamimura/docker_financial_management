-- カードで毎月固定決済される支払い（サブスク・通信費など）を、カード側で登録できるようにする。
--
-- 背景: これまでカード明細から「固定入出金」を登録すると Transfer（資金移動ルール）が作られ、
-- 引き落とし元の銀行口座の指定が必須だった。しかしカード払いのサブスクは利用時点で現金が動かず、
-- 実際の出金はカード全体の引き落とし 1 本にまとまる。Transfer として登録すると、その引き落とし
-- ルールと合わせて同じ支出が資金繰り・残高予測に二重で乗ってしまう。
--
-- 対応: 銀行の資金繰りには影響しない、カード（linked_accounts）に紐づく独立したテーブルを追加する。
-- 用途は「このカードで毎月いくら固定で決済されるか」の把握（カード管理のサマリ・明細一覧）。

-- CreateTable
CREATE TABLE "card_recurring_payments" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "day" INTEGER NOT NULL,
    "categoryAccountId" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "card_recurring_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "card_recurring_payments_accountId_label_key" ON "card_recurring_payments"("accountId", "label");

-- CreateIndex
CREATE INDEX "card_recurring_payments_tenantId_idx" ON "card_recurring_payments"("tenantId");

-- CreateIndex
CREATE INDEX "card_recurring_payments_categoryAccountId_idx" ON "card_recurring_payments"("categoryAccountId");

-- AddForeignKey
ALTER TABLE "card_recurring_payments" ADD CONSTRAINT "card_recurring_payments_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "linked_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_recurring_payments" ADD CONSTRAINT "card_recurring_payments_categoryAccountId_fkey"
  FOREIGN KEY ("categoryAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
