-- Phase 2: F005 証憑 / F006 棚卸 / F007 固定資産 / F008 減価償却 / F009 家事按分

-- F005 証憑ファイル
CREATE TABLE "receipts" (
    "id"             SERIAL PRIMARY KEY,
    "journalEntryId" INTEGER NOT NULL REFERENCES "journal_entries"("id") ON DELETE CASCADE,
    "fileName"       TEXT NOT NULL,
    "fileUrl"        TEXT NOT NULL,
    "fileType"       TEXT NOT NULL DEFAULT 'other',
    "fileSize"       INTEGER NOT NULL DEFAULT 0,
    "uploadedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "receipts_journalEntryId_idx" ON "receipts"("journalEntryId");

-- F006 棚卸帳
CREATE TABLE "inventories" (
    "id"            SERIAL PRIMARY KEY,
    "name"          TEXT NOT NULL,
    "inventoryDate" TIMESTAMP(3) NOT NULL,
    "status"        TEXT NOT NULL DEFAULT 'open',
    "totalAmount"   DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "inventories_inventoryDate_idx" ON "inventories"("inventoryDate");

CREATE TABLE "inventory_items" (
    "id"          SERIAL PRIMARY KEY,
    "inventoryId" INTEGER NOT NULL REFERENCES "inventories"("id") ON DELETE CASCADE,
    "itemName"    TEXT NOT NULL,
    "quantity"    DECIMAL(10,3) NOT NULL DEFAULT 0,
    "unit"        TEXT NOT NULL DEFAULT '個',
    "unitPrice"   DECIMAL(18,2) NOT NULL DEFAULT 0,
    "totalAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "inventory_items_inventoryId_idx" ON "inventory_items"("inventoryId");

-- F007 固定資産台帳
CREATE TABLE "fixed_assets" (
    "id"              SERIAL PRIMARY KEY,
    "name"            TEXT NOT NULL,
    "category"        TEXT NOT NULL DEFAULT 'tangible',
    "acquiredOn"      TIMESTAMP(3) NOT NULL,
    "acquisitionCost" DECIMAL(18,2) NOT NULL,
    "usefulLife"      INTEGER NOT NULL,
    "method"          TEXT NOT NULL DEFAULT 'straight',
    "residualRate"    DECIMAL(5,4) NOT NULL DEFAULT 0.1,
    "bookValue"       DECIMAL(18,2) NOT NULL,
    "disposedOn"      TIMESTAMP(3),
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- F008 減価償却明細
CREATE TABLE "depreciations" (
    "id"           SERIAL PRIMARY KEY,
    "fixedAssetId" INTEGER NOT NULL REFERENCES "fixed_assets"("id") ON DELETE CASCADE,
    "fiscalYear"   INTEGER NOT NULL,
    "amount"       DECIMAL(18,2) NOT NULL,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("fixedAssetId", "fiscalYear")
);
CREATE INDEX "depreciations_fixedAssetId_idx" ON "depreciations"("fixedAssetId");

-- F009 家事按分設定
CREATE TABLE "apportionments" (
    "id"           SERIAL PRIMARY KEY,
    "accountId"    INTEGER NOT NULL REFERENCES "accounts"("id"),
    "businessRate" DECIMAL(5,2) NOT NULL,
    "description"  TEXT,
    "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE("accountId")
);
