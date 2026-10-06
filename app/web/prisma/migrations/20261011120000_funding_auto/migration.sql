-- 資金繰りを、登録済みの情報から自動で割り出すための列とテーブル。
--
-- 1. loans に返済の引き落とし口座と日を足す。入っていれば、月々の返済額を資金繰り・資金フロー図に自動で並べる。
-- 2. recurring_suggestion_dismissals: 明細から見つけた「毎月の入出金」の候補のうち、非表示にしたもの。

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "debitBankAccountId" INTEGER,
ADD COLUMN     "debitDay" INTEGER;

-- CreateTable
CREATE TABLE "recurring_suggestion_dismissals" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "bankAccountId" INTEGER NOT NULL,
    "signature" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recurring_suggestion_dismissals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "recurring_suggestion_dismissals_tenantId_idx" ON "recurring_suggestion_dismissals"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "recurring_suggestion_dismissals_tenantId_bankAccountId_sign_key" ON "recurring_suggestion_dismissals"("tenantId", "bankAccountId", "signature");

-- AddForeignKey
ALTER TABLE "loans" ADD CONSTRAINT "loans_debitBankAccountId_fkey" FOREIGN KEY ("debitBankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recurring_suggestion_dismissals" ADD CONSTRAINT "recurring_suggestion_dismissals_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
