-- CreateEnum
CREATE TYPE "BankAccountRole" AS ENUM ('SALARY', 'WITHDRAWAL', 'SAVINGS', 'OTHER');

-- CreateEnum
CREATE TYPE "TransferKind" AS ENUM ('MANUAL', 'AUTO');

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT NOT NULL,
    "branchName" TEXT,
    "accountType" TEXT NOT NULL DEFAULT '普通',
    "role" "BankAccountRole" NOT NULL DEFAULT 'OTHER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfers" (
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

-- CreateIndex
CREATE INDEX "transfers_fromAccountId_idx" ON "transfers"("fromAccountId");

-- CreateIndex
CREATE INDEX "transfers_toAccountId_idx" ON "transfers"("toAccountId");

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_fromAccountId_fkey" FOREIGN KEY ("fromAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfers" ADD CONSTRAINT "transfers_toAccountId_fkey" FOREIGN KEY ("toAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
