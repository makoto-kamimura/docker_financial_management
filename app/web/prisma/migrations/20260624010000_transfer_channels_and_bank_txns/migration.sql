-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "TransferChannel" AS ENUM ('BANK_TRANSFER', 'AUTO_DEBIT', 'CARD_PAYMENT', 'INCOME', 'EXPENSE');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TxnSource" AS ENUM ('MANUAL', 'CSV', 'SYNC');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- transfers: fromAccountId / toAccountId を null 許容に変更し channel / label を追加
ALTER TABLE "transfers" ALTER COLUMN "fromAccountId" DROP NOT NULL;
ALTER TABLE "transfers" ALTER COLUMN "toAccountId" DROP NOT NULL;
ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "channel" "TransferChannel" NOT NULL DEFAULT 'BANK_TRANSFER';
ALTER TABLE "transfers" ADD COLUMN IF NOT EXISTS "label" TEXT;

-- FK を NULL 許容 + ON DELETE SET NULL に張り直し
ALTER TABLE "transfers" DROP CONSTRAINT IF EXISTS "transfers_fromAccountId_fkey";
ALTER TABLE "transfers" DROP CONSTRAINT IF EXISTS "transfers_toAccountId_fkey";
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_fromAccountId_fkey"
  FOREIGN KEY ("fromAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_toAccountId_fkey"
  FOREIGN KEY ("toAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- bank_transactions: 旧スキーマ（bankAccountId / transactionDate / balanceAfter）を
-- 新スキーマ（accountId / date / balance / source / externalId）に置き換える
DROP TABLE IF EXISTS "bank_transactions" CASCADE;

CREATE TABLE "bank_transactions" (
    "id" SERIAL NOT NULL,
    "accountId" INTEGER NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balance" DECIMAL(18,2),
    "source" "TxnSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_transactions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "bank_transactions_accountId_date_idx" ON "bank_transactions"("accountId", "date");
CREATE UNIQUE INDEX "bank_transactions_accountId_externalId_key" ON "bank_transactions"("accountId", "externalId");

ALTER TABLE "bank_transactions" ADD CONSTRAINT "bank_transactions_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
