-- 明細ごとの事業利用（個人事業主モードで事業の分として数える）と按分（%）。
--   - 明細（kind を持つ行）だけが持つ。振替・チャージの組は収入・支出ではないので持たない
--   - 事業利用なら按分（0 より大きく 100 以下）が必須、事業利用でなければ按分は空
--   - 学習ルールにも同じ 2 列を足す。null は「ルールでは事業利用を決めない」
--   - 既存の明細とルールは、事業利用なし（ルールは決めない）で始まる

-- AlterTable
ALTER TABLE "financial_records" ADD COLUMN     "businessRatio" DECIMAL(5,2),
ADD COLUMN     "businessUse" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "txn_category_rules" ADD COLUMN     "businessRatio" DECIMAL(5,2),
ADD COLUMN     "businessUse" BOOLEAN;


ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_business_ratio"
  CHECK ("businessUse" = ("businessRatio" IS NOT NULL)
    AND ("businessRatio" IS NULL OR ("businessRatio" > 0 AND "businessRatio" <= 100)));

ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_business_entry_only"
  CHECK (NOT "businessUse" OR ("kind" IS NOT NULL
    AND "transferGroupId" IS NULL AND "chargeToCardId" IS NULL AND "chargeGroupId" IS NULL));

ALTER TABLE "txn_category_rules" ADD CONSTRAINT "txn_category_rules_business_ratio"
  CHECK (("businessUse" IS TRUE) = ("businessRatio" IS NOT NULL)
    AND ("businessRatio" IS NULL OR ("businessRatio" > 0 AND "businessRatio" <= 100)));
