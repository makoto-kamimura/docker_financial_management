-- 銀行明細（bank_transactions）とカード明細（card_transactions）を 1 つの明細の表（ledger_entries）にまとめる。
--   - kind で台帳の種別（CASH / BANK / CARD）を分け、口座は kind に合う列だけを持つ
--   - 金額は種別によらず +入金 / −出金にそろえる（カード明細は +利用 / −返金だったので符号を反転する）
--   - カードのチャージ先（transferToAccountId）と銀行のチャージ先（chargeToAccountId）は chargeToCardId に 1 つにする
--   - 銀行明細の id はそのまま引き継ぎ、カード明細には新しい id を振る（明細の id を参照する FK は無い）

-- CreateEnum
CREATE TYPE "LedgerKind" AS ENUM ('CASH', 'BANK', 'CARD');

-- CreateTable
CREATE TABLE "ledger_entries" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "kind" "LedgerKind" NOT NULL,
    "bankAccountId" INTEGER,
    "cardAccountId" INTEGER,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "balance" DECIMAL(18,2),
    "source" "TxnSource" NOT NULL DEFAULT 'MANUAL',
    "externalId" TEXT,
    "categoryAccountId" INTEGER,
    "postedRecordId" INTEGER,
    "transferGroupId" TEXT,
    "chargeToCardId" INTEGER,
    "chargeGroupId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_entries_pkey" PRIMARY KEY ("id"),
    -- 口座は kind に合う列だけを持つ（現金はどちらも持たない）
    CONSTRAINT "ledger_entries_kind_account_check" CHECK (
        ("kind" = 'CASH' AND "bankAccountId" IS NULL AND "cardAccountId" IS NULL)
        OR ("kind" = 'BANK' AND "bankAccountId" IS NOT NULL AND "cardAccountId" IS NULL)
        OR ("kind" = 'CARD' AND "cardAccountId" IS NOT NULL AND "bankAccountId" IS NULL)
    )
);

-- 銀行明細（id はそのまま）
INSERT INTO "ledger_entries" (
    "id", "tenantId", "kind", "bankAccountId", "date", "description", "amount", "balance",
    "source", "externalId", "categoryAccountId", "postedRecordId", "transferGroupId",
    "chargeToCardId", "chargeGroupId", "createdAt"
)
SELECT t."id", a."tenantId", 'BANK', t."accountId", t."date", t."description", t."amount", t."balance",
       t."source", t."externalId", t."categoryAccountId", t."postedRecordId", t."transferGroupId",
       t."chargeToAccountId", t."chargeGroupId", t."createdAt"
FROM "bank_transactions" t
JOIN "bank_accounts" a ON a."id" = t."accountId";

SELECT setval(
    pg_get_serial_sequence('ledger_entries', 'id'),
    GREATEST((SELECT COALESCE(MAX("id"), 0) FROM "ledger_entries"), 1),
    (SELECT COUNT(*) > 0 FROM "ledger_entries")
);

-- カード明細（id は振り直し、金額は反転）
INSERT INTO "ledger_entries" (
    "tenantId", "kind", "cardAccountId", "date", "description", "amount",
    "source", "externalId", "categoryAccountId", "postedRecordId",
    "chargeToCardId", "chargeGroupId", "createdAt"
)
SELECT a."tenantId", 'CARD', t."accountId", t."date", t."description", -t."amount",
       t."source", t."externalId", t."categoryAccountId", t."postedRecordId",
       t."transferToAccountId", t."chargeGroupId", t."createdAt"
FROM "card_transactions" t
JOIN "linked_accounts" a ON a."id" = t."accountId"
ORDER BY t."id";

-- DropForeignKey
ALTER TABLE "bank_transactions" DROP CONSTRAINT "bank_transactions_accountId_fkey";
ALTER TABLE "bank_transactions" DROP CONSTRAINT "bank_transactions_categoryAccountId_fkey";
ALTER TABLE "bank_transactions" DROP CONSTRAINT "bank_transactions_chargeToAccountId_fkey";
ALTER TABLE "bank_transactions" DROP CONSTRAINT "bank_transactions_postedRecordId_fkey";
ALTER TABLE "card_transactions" DROP CONSTRAINT "card_transactions_accountId_fkey";
ALTER TABLE "card_transactions" DROP CONSTRAINT "card_transactions_categoryAccountId_fkey";
ALTER TABLE "card_transactions" DROP CONSTRAINT "card_transactions_postedRecordId_fkey";
ALTER TABLE "card_transactions" DROP CONSTRAINT "card_transactions_transferToAccountId_fkey";

-- DropTable
DROP TABLE "bank_transactions";
DROP TABLE "card_transactions";

-- CreateIndex
CREATE UNIQUE INDEX "ledger_entries_postedRecordId_key" ON "ledger_entries"("postedRecordId");
CREATE INDEX "ledger_entries_tenantId_date_idx" ON "ledger_entries"("tenantId", "date");
CREATE INDEX "ledger_entries_bankAccountId_date_idx" ON "ledger_entries"("bankAccountId", "date");
CREATE INDEX "ledger_entries_cardAccountId_date_idx" ON "ledger_entries"("cardAccountId", "date");
CREATE INDEX "ledger_entries_categoryAccountId_idx" ON "ledger_entries"("categoryAccountId");
CREATE INDEX "ledger_entries_transferGroupId_idx" ON "ledger_entries"("transferGroupId");
CREATE INDEX "ledger_entries_chargeToCardId_idx" ON "ledger_entries"("chargeToCardId");
CREATE INDEX "ledger_entries_chargeGroupId_idx" ON "ledger_entries"("chargeGroupId");
CREATE UNIQUE INDEX "ledger_entries_bankAccountId_externalId_key" ON "ledger_entries"("bankAccountId", "externalId");
CREATE UNIQUE INDEX "ledger_entries_cardAccountId_externalId_key" ON "ledger_entries"("cardAccountId", "externalId");

-- AddForeignKey
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_cardAccountId_fkey" FOREIGN KEY ("cardAccountId") REFERENCES "linked_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_categoryAccountId_fkey" FOREIGN KEY ("categoryAccountId") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_postedRecordId_fkey" FOREIGN KEY ("postedRecordId") REFERENCES "financial_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_chargeToCardId_fkey" FOREIGN KEY ("chargeToCardId") REFERENCES "linked_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
