-- 明細分けの商品ごとの行（内訳）と、商品名の学習ルール

-- AlterTable
ALTER TABLE "financial_records" ADD COLUMN     "splitOfId" INTEGER;

-- CreateTable
CREATE TABLE "shop_item_rules" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "keyword" TEXT NOT NULL,
    "categoryAccountId" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "businessUse" BOOLEAN,
    "businessRatio" DECIMAL(5,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_item_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_item_rules_tenantId_idx" ON "shop_item_rules"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "shop_item_rules_tenantId_keyword_key" ON "shop_item_rules"("tenantId", "keyword");

-- CreateIndex
CREATE INDEX "financial_records_splitOfId_idx" ON "financial_records"("splitOfId");

-- AddForeignKey
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_splitOfId_fkey" FOREIGN KEY ("splitOfId") REFERENCES "financial_records"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_item_rules" ADD CONSTRAINT "shop_item_rules_categoryAccountId_fkey" FOREIGN KEY ("categoryAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- 内訳の行: kind を持たず（明細の一覧・残高に出ない）、親の明細を指す。
-- 日付・摘要（商品名）・flow（割り振った額）を持ち、科目の無い商品の行は科目が空（未割り当て）
ALTER TABLE "financial_records" DROP CONSTRAINT "financial_records_entry_fields_check";
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_entry_fields_check" CHECK (
  ("kind" IS NULL AND "splitOfId" IS NULL AND "accountId" IS NOT NULL)
  OR ("kind" IS NULL AND "splitOfId" IS NOT NULL AND "date" IS NOT NULL AND "description" IS NOT NULL AND "flow" IS NOT NULL)
  OR ("kind" IS NOT NULL AND "splitOfId" IS NULL AND "date" IS NOT NULL AND "description" IS NOT NULL AND "flow" IS NOT NULL)
);

-- 事業利用は明細と、その内訳の行だけが持つ（振替・チャージの組には付かない）
ALTER TABLE "financial_records" DROP CONSTRAINT "financial_records_business_entry_only";
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_business_entry_only" CHECK (
  (NOT "businessUse")
  OR (("kind" IS NOT NULL OR "splitOfId" IS NOT NULL)
    AND "transferGroupId" IS NULL AND "chargeToCardId" IS NULL AND "chargeGroupId" IS NULL)
);

-- 内訳の行は振替・チャージの組にならない
ALTER TABLE "financial_records" ADD CONSTRAINT "financial_records_split_unpaired" CHECK (
  "splitOfId" IS NULL
  OR ("transferGroupId" IS NULL AND "chargeToCardId" IS NULL AND "chargeGroupId" IS NULL)
);
