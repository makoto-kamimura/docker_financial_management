-- F001: 事業者情報
CREATE TABLE "business_profiles" (
    "id"            SERIAL PRIMARY KEY,
    "tradeName"     TEXT,
    "ownerName"     TEXT NOT NULL DEFAULT '',
    "openedOn"      TIMESTAMP(3),
    "blueReturn"    BOOLEAN NOT NULL DEFAULT false,
    "invoiceNumber" TEXT,
    "taxationType"  TEXT NOT NULL DEFAULT 'exempt',
    "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- F012: 消費税設定
CREATE TABLE "tax_settings" (
    "id"             SERIAL PRIMARY KEY,
    "taxYear"        INTEGER NOT NULL,
    "taxationType"   TEXT NOT NULL,
    "simplifiedRate" DECIMAL(5,2),
    "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tax_settings_taxYear_key" UNIQUE ("taxYear")
);

-- F002: 仕訳帳ヘッダ
CREATE TABLE "journal_entries" (
    "id"              SERIAL PRIMARY KEY,
    "transactionDate" TIMESTAMP(3) NOT NULL,
    "description"     TEXT NOT NULL,
    "paymentMethod"   TEXT NOT NULL DEFAULT 'cash',
    "taxCategory"     TEXT NOT NULL DEFAULT 'taxable',
    "receiptUrl"      TEXT,
    "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "journal_entries_transactionDate_idx" ON "journal_entries"("transactionDate");

-- F002: 仕訳明細（複式簿記）
CREATE TABLE "journal_details" (
    "id"             SERIAL PRIMARY KEY,
    "journalEntryId" INTEGER NOT NULL,
    "side"           TEXT NOT NULL,
    "accountId"      INTEGER NOT NULL,
    "amount"         DECIMAL(18,2) NOT NULL,
    "note"           TEXT,
    CONSTRAINT "journal_details_journalEntryId_fkey"
        FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE,
    CONSTRAINT "journal_details_accountId_fkey"
        FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
);

CREATE INDEX "journal_details_journalEntryId_idx" ON "journal_details"("journalEntryId");
