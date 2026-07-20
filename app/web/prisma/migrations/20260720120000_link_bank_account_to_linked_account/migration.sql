-- AlterTable
ALTER TABLE "linked_accounts" ADD COLUMN     "bankAccountId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "linked_accounts_bankAccountId_key" ON "linked_accounts"("bankAccountId");

-- AddForeignKey
ALTER TABLE "linked_accounts" ADD CONSTRAINT "linked_accounts_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
