-- D-1: 銀行口座台帳の一本化
-- linked_accounts (type=BANK) を bank_accounts へ統合し、linked_accounts はカード専用に縮小する。

-- 1. bank_accounts に統合先カラムを追加
ALTER TABLE "bank_accounts" ADD COLUMN "lastFour" TEXT;
ALTER TABLE "bank_accounts" ADD COLUMN "accountId" INTEGER;
ALTER TABLE "bank_accounts" ADD COLUMN "note" TEXT;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "bank_accounts_accountId_idx" ON "bank_accounts"("accountId");

-- 2. bankAccountId 連携済みの BANK 行の属性を bank_accounts へマージ
UPDATE "bank_accounts" b
SET "lastFour" = la."lastFour",
    "accountId" = la."accountId",
    "note" = la."note"
FROM "linked_accounts" la
WHERE la."bankAccountId" = b."id"
  AND la."type" = 'BANK';

-- 3. 未連携の BANK 行を bank_accounts として新規作成（institution → bankName）
INSERT INTO "bank_accounts" ("tenantId", "name", "bankName", "lastFour", "accountId", "note")
SELECT la."tenantId", la."name", la."institution", la."lastFour", la."accountId", la."note"
FROM "linked_accounts" la
WHERE la."type" = 'BANK'
  AND la."bankAccountId" IS NULL;

-- 4. BANK 行を linked_accounts から削除し、暫定同期用カラムを撤去
DELETE FROM "linked_accounts" WHERE "type" = 'BANK';

ALTER TABLE "linked_accounts" DROP CONSTRAINT "linked_accounts_bankAccountId_fkey";
DROP INDEX "linked_accounts_bankAccountId_key";
ALTER TABLE "linked_accounts" DROP COLUMN "bankAccountId";
