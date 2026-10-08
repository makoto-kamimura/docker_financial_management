-- 実績の表（financial_records）に明細そのものを載せ、実績と明細を 1 つの表にする。
--   - 明細の表（ledger_entries）の行を financial_records へ移し、ledger_entries は消す
--   - 科目（accountId）が付いた行が実績。科目が無い行（未割り当て・振替・チャージ）は amount = 0
--   - flow は明細の入出金（+入金 / −出金）。amount は科目の向きの実績の金額
--     （費用・売上原価・資産は支出が正 = −flow、それ以外は入金が正 = flow。lib/journal.ts の signedActualAmountFromSpend）
--   - 転記済みの明細は、写しだった実績の行に明細の列を書き込んで 1 行にする（転記の写しはなくなる）
--   - 期間は取引日の年月（サーバーの年月。resolvePeriodForDate と同じ）

-- AlterTable
ALTER TABLE "financial_records" ADD COLUMN     "balance" DECIMAL(18,2),
ADD COLUMN     "bankAccountId" INTEGER,
ADD COLUMN     "cardAccountId" INTEGER,
ADD COLUMN     "chargeGroupId" TEXT,
ADD COLUMN     "chargeToCardId" INTEGER,
ADD COLUMN     "date" TIMESTAMP(3),
ADD COLUMN     "description" TEXT,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "flow" DECIMAL(18,2),
ADD COLUMN     "kind" "LedgerKind",
ADD COLUMN     "source" "TxnSource",
ADD COLUMN     "transferGroupId" TEXT,
ALTER COLUMN "accountId" DROP NOT NULL;

-- 明細ごとの「実績としての科目と金額」
CREATE TEMP TABLE "_entry_actual" AS
SELECT e."id",
       CASE WHEN e."transferGroupId" IS NULL AND e."chargeToCardId" IS NULL AND e."chargeGroupId" IS NULL
            THEN e."categoryAccountId" END AS "accountId",
       CASE WHEN e."categoryAccountId" IS NULL
              OR e."transferGroupId" IS NOT NULL OR e."chargeToCardId" IS NOT NULL OR e."chargeGroupId" IS NOT NULL
            THEN 0
            WHEN a."category" IN ('ASSET', 'EXPENSE', 'COGS') THEN -e."amount"
            ELSE e."amount" END AS "amount"
FROM "ledger_entries" e
LEFT JOIN "accounts" a ON a."id" = e."categoryAccountId";

-- 転記の写しが仕訳から作られていた場合は、その仕訳を消す（明細の行が実績そのものになるため）
CREATE TEMP TABLE "_posted_journals" AS
SELECT DISTINCT f."journalEntryId" AS "id"
FROM "financial_records" f
JOIN "ledger_entries" e ON e."postedRecordId" = f."id"
WHERE f."journalEntryId" IS NOT NULL;

UPDATE "financial_records" SET "journalEntryId" = NULL
WHERE "journalEntryId" IN (SELECT "id" FROM "_posted_journals");
DELETE FROM "journal_details" WHERE "journalEntryId" IN (SELECT "id" FROM "_posted_journals");
DELETE FROM "journal_entries" WHERE "id" IN (SELECT "id" FROM "_posted_journals");

-- 転記済みの明細: 写しの行に明細の列を書き込む
UPDATE "financial_records" f
SET "kind" = e."kind",
    "bankAccountId" = e."bankAccountId",
    "cardAccountId" = e."cardAccountId",
    "date" = e."date",
    "description" = e."description",
    "flow" = e."amount",
    "balance" = e."balance",
    "source" = e."source",
    "externalId" = e."externalId",
    "transferGroupId" = e."transferGroupId",
    "chargeToCardId" = e."chargeToCardId",
    "chargeGroupId" = e."chargeGroupId",
    "accountId" = x."accountId",
    "amount" = x."amount",
    "createdAt" = e."createdAt"
FROM "ledger_entries" e
JOIN "_entry_actual" x ON x."id" = e."id"
WHERE e."postedRecordId" = f."id";

-- 転記していない明細: 取引日の年月の期間を用意して、新しい行として入れる
INSERT INTO "periods" ("tenantId", "fiscalYear", "month", "quarter")
SELECT DISTINCT e."tenantId",
       EXTRACT(YEAR FROM e."date")::int,
       EXTRACT(MONTH FROM e."date")::int,
       ((EXTRACT(MONTH FROM e."date")::int + 2) / 3)
FROM "ledger_entries" e
WHERE e."postedRecordId" IS NULL
ON CONFLICT ("tenantId", "fiscalYear", "month") DO NOTHING;

INSERT INTO "financial_records" (
    "tenantId", "accountId", "periodId", "amount", "createdAt", "updatedAt",
    "kind", "bankAccountId", "cardAccountId", "date", "description", "flow", "balance",
    "source", "externalId", "transferGroupId", "chargeToCardId", "chargeGroupId"
)
SELECT e."tenantId", x."accountId", p."id", x."amount", e."createdAt", CURRENT_TIMESTAMP,
       e."kind", e."bankAccountId", e."cardAccountId", e."date", e."description", e."amount", e."balance",
       e."source", e."externalId", e."transferGroupId", e."chargeToCardId", e."chargeGroupId"
FROM "ledger_entries" e
JOIN "_entry_actual" x ON x."id" = e."id"
JOIN "periods" p
  ON p."tenantId" = e."tenantId"
 AND p."fiscalYear" = EXTRACT(YEAR FROM e."date")::int
 AND p."month" = EXTRACT(MONTH FROM e."date")::int
WHERE e."postedRecordId" IS NULL
ORDER BY e."id";

-- DropTable
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_bankAccountId_fkey";
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_cardAccountId_fkey";
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_categoryAccountId_fkey";
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_chargeToCardId_fkey";
ALTER TABLE "ledger_entries" DROP CONSTRAINT "ledger_entries_postedRecordId_fkey";
DROP TABLE "ledger_entries";

-- 明細の決まり
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_kind_account_check" CHECK (
    ("kind" IS NULL AND "bankAccountId" IS NULL AND "cardAccountId" IS NULL)
    OR ("kind" = 'CASH' AND "bankAccountId" IS NULL AND "cardAccountId" IS NULL)
    OR ("kind" = 'BANK' AND "bankAccountId" IS NOT NULL AND "cardAccountId" IS NULL)
    OR ("kind" = 'CARD' AND "cardAccountId" IS NOT NULL AND "bankAccountId" IS NULL)
);
-- 明細の行は日付・摘要・入出金を持つ。明細でない行は科目を持つ
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_entry_fields_check" CHECK (
    ("kind" IS NULL AND "accountId" IS NOT NULL)
    OR ("kind" IS NOT NULL AND "date" IS NOT NULL AND "description" IS NOT NULL AND "flow" IS NOT NULL)
);
-- 振替・チャージの組の行は科目を持たない（自己資金の移動は収入でも支出でもない）
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_pair_no_account_check" CHECK (
    "accountId" IS NULL
    OR ("transferGroupId" IS NULL AND "chargeToCardId" IS NULL AND "chargeGroupId" IS NULL)
);

-- CreateIndex
CREATE INDEX "financial_records_tenantId_date_idx" ON "financial_records"("tenantId", "date");
CREATE INDEX "financial_records_bankAccountId_date_idx" ON "financial_records"("bankAccountId", "date");
CREATE INDEX "financial_records_cardAccountId_date_idx" ON "financial_records"("cardAccountId", "date");
CREATE INDEX "financial_records_transferGroupId_idx" ON "financial_records"("transferGroupId");
CREATE INDEX "financial_records_chargeToCardId_idx" ON "financial_records"("chargeToCardId");
CREATE INDEX "financial_records_chargeGroupId_idx" ON "financial_records"("chargeGroupId");
CREATE UNIQUE INDEX "financial_records_bankAccountId_externalId_key" ON "financial_records"("bankAccountId", "externalId");
CREATE UNIQUE INDEX "financial_records_cardAccountId_externalId_key" ON "financial_records"("cardAccountId", "externalId");

-- AddForeignKey
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_cardAccountId_fkey" FOREIGN KEY ("cardAccountId") REFERENCES "linked_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_chargeToCardId_fkey" FOREIGN KEY ("chargeToCardId") REFERENCES "linked_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
