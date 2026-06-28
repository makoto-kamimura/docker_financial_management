-- CreateEnum (idempotent)
DO $$ BEGIN
  CREATE TYPE "BankAccountRole" AS ENUM ('SALARY', 'WITHDRAWAL', 'SAVINGS', 'OTHER');
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  CREATE TYPE "TransferKind" AS ENUM ('MANUAL', 'AUTO');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- bank_accounts は既存テーブルに role 列を追加（なければ）
ALTER TABLE "bank_accounts" ADD COLUMN IF NOT EXISTS "role" "BankAccountRole" NOT NULL DEFAULT 'OTHER';

-- transfers テーブルを新規作成
CREATE TABLE IF NOT EXISTS "transfers" (
    "id" SERIAL NOT NULL,
    "fromAccountId" INTEGER NOT NULL,
    "toAccountId" INTEGER NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "kind" "TransferKind" NOT NULL DEFAULT 'AUTO',
    "day" INTEGER NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfers_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "transfers_fromAccountId_idx" ON "transfers"("fromAccountId");
CREATE INDEX IF NOT EXISTS "transfers_toAccountId_idx" ON "transfers"("toAccountId");

ALTER TABLE "transfers" DROP CONSTRAINT IF EXISTS "transfers_fromAccountId_fkey";
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_fromAccountId_fkey"
  FOREIGN KEY ("fromAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "transfers" DROP CONSTRAINT IF EXISTS "transfers_toAccountId_fkey";
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_toAccountId_fkey"
  FOREIGN KEY ("toAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
