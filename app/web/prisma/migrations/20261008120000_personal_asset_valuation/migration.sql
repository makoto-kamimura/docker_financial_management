-- 実物資産の価値の推移（内訳・価値の変わり方・評価額の記録）。
--
-- 1. personal_assets に価値の変わり方（auto / fixed / rate / straight_line / declining）と、その設定を足す。
-- 2. personal_asset_parts: 1 つの資産の内訳（住宅ローン 1 本で買った土地と建物など）。1 ローン 1 資産のまま、
--    内訳ごとに価値の変わり方を持てるようにする。
-- 3. personal_asset_valuations: 評価額を手で入れた記録。推移はこの点を通り、最後の点から先を見積もる。
--    既存の資産は、最後に更新した日の評価額を 1 件目の記録として入れる。

-- AlterTable
ALTER TABLE "personal_assets" ADD COLUMN     "buildingStructure" TEXT,
ADD COLUMN     "usefulLifeYears" INTEGER,
ADD COLUMN     "valuationMethod" TEXT NOT NULL DEFAULT 'auto',
ADD COLUMN     "valuationRate" DECIMAL(7,3);

-- CreateTable
CREATE TABLE "personal_asset_parts" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "assetId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "category" "PersonalAssetCategory" NOT NULL DEFAULT 'OTHER',
    "acquisitionCost" DECIMAL(18,2),
    "currentValue" DECIMAL(18,2) NOT NULL,
    "valuationMethod" TEXT NOT NULL DEFAULT 'auto',
    "valuationRate" DECIMAL(7,3),
    "usefulLifeYears" INTEGER,
    "buildingStructure" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "personal_asset_parts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "personal_asset_valuations" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "assetId" INTEGER NOT NULL,
    "partId" INTEGER,
    "valuedOn" DATE NOT NULL,
    "value" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "personal_asset_valuations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "personal_asset_parts_tenantId_idx" ON "personal_asset_parts"("tenantId");

-- CreateIndex
CREATE INDEX "personal_asset_parts_assetId_idx" ON "personal_asset_parts"("assetId");

-- CreateIndex
CREATE INDEX "personal_asset_valuations_tenantId_idx" ON "personal_asset_valuations"("tenantId");

-- CreateIndex
CREATE INDEX "personal_asset_valuations_assetId_idx" ON "personal_asset_valuations"("assetId");

-- CreateIndex
CREATE INDEX "personal_asset_valuations_partId_idx" ON "personal_asset_valuations"("partId");

-- AddForeignKey
ALTER TABLE "personal_asset_parts" ADD CONSTRAINT "personal_asset_parts_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "personal_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_asset_valuations" ADD CONSTRAINT "personal_asset_valuations_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "personal_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "personal_asset_valuations" ADD CONSTRAINT "personal_asset_valuations_partId_fkey" FOREIGN KEY ("partId") REFERENCES "personal_asset_parts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- 既存の資産: 最後に更新した日の評価額を、評価額の記録の 1 件目にする
INSERT INTO "personal_asset_valuations" ("tenantId", "assetId", "partId", "valuedOn", "value")
SELECT "tenantId", "id", NULL, "updatedAt"::date, "currentValue" FROM "personal_assets";
