-- クレジットカード利用明細（card_transactions）。
-- BankTransaction と同構造・同機能をカード（LinkedAccount, type=CREDIT_CARD）側にも提供する。
-- 銀行側（bank_transactions / bank_accounts）は変更しない。

-- CreateTable
CREATE TABLE "card_transactions" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "source" "TxnSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "categoryAccountId" INTEGER,
    "postedRecordId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "card_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "card_transactions_accountId_date_idx" ON "card_transactions"("accountId", "date");
CREATE UNIQUE INDEX "card_transactions_accountId_externalId_key" ON "card_transactions"("accountId", "externalId");
CREATE UNIQUE INDEX "card_transactions_postedRecordId_key" ON "card_transactions"("postedRecordId");
CREATE INDEX "card_transactions_categoryAccountId_idx" ON "card_transactions"("categoryAccountId");

-- AddForeignKey
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "linked_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_categoryAccountId_fkey"
  FOREIGN KEY ("categoryAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "card_transactions" ADD CONSTRAINT "card_transactions_postedRecordId_fkey"
  FOREIGN KEY ("postedRecordId") REFERENCES "financial_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
