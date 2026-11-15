-- 明細分け（明細管理で登録する通販の注文の取り込み先）と、その請求・商品

-- CreateEnum
CREATE TYPE "ShopLinkSource" AS ENUM ('AUTO', 'MANUAL');

-- CreateTable
CREATE TABLE "shop_accounts" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "matchKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "excludeKeywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "paymentCardIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "paymentBankIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "statementUrl" TEXT,
    "csvMapping" JSONB,
    "businessUse" BOOLEAN NOT NULL DEFAULT false,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_charges" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "shopAccountId" INTEGER NOT NULL,
    "orderNo" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "sellerName" TEXT,
    "externalKey" TEXT NOT NULL,
    "entryId" INTEGER,
    "linkedBy" "ShopLinkSource",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_charges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "shop_order_items" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "chargeId" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "amount" DECIMAL(18,2) NOT NULL,
    "categoryAccountId" INTEGER,
    "businessUse" BOOLEAN NOT NULL DEFAULT false,
    "businessRatio" DECIMAL(5,2),
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "shop_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "shop_accounts_tenantId_idx" ON "shop_accounts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "shop_charges_entryId_key" ON "shop_charges"("entryId");

-- CreateIndex
CREATE INDEX "shop_charges_tenantId_date_idx" ON "shop_charges"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "shop_charges_shopAccountId_externalKey_key" ON "shop_charges"("shopAccountId", "externalKey");

-- CreateIndex
CREATE INDEX "shop_order_items_chargeId_idx" ON "shop_order_items"("chargeId");

-- CreateIndex
CREATE INDEX "shop_order_items_tenantId_categoryAccountId_idx" ON "shop_order_items"("tenantId", "categoryAccountId");

-- AddForeignKey
ALTER TABLE "shop_charges" ADD CONSTRAINT "shop_charges_shopAccountId_fkey" FOREIGN KEY ("shopAccountId") REFERENCES "shop_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_charges" ADD CONSTRAINT "shop_charges_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "financial_records"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_chargeId_fkey" FOREIGN KEY ("chargeId") REFERENCES "shop_charges"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shop_order_items" ADD CONSTRAINT "shop_order_items_categoryAccountId_fkey" FOREIGN KEY ("categoryAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

