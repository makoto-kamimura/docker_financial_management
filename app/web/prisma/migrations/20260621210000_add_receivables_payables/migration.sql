-- F010 売掛金管理
CREATE TABLE "receivables" (
    "id"            SERIAL PRIMARY KEY,
    "customerName"  TEXT          NOT NULL,
    "description"   TEXT          NOT NULL,
    "amount"        DECIMAL(18,2) NOT NULL,
    "taxAmount"     DECIMAL(18,2) NOT NULL DEFAULT 0,
    "issueDate"     TIMESTAMP(3)  NOT NULL,
    "dueDate"       TIMESTAMP(3)  NOT NULL,
    "status"        TEXT          NOT NULL DEFAULT 'open',
    "paidOn"        TIMESTAMP(3),
    "paidAmount"    DECIMAL(18,2),
    "invoiceNumber" TEXT,
    "note"          TEXT,
    "createdAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"     TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "receivables_dueDate_idx" ON "receivables"("dueDate");
CREATE INDEX "receivables_status_idx"  ON "receivables"("status");

-- F011 買掛金管理
CREATE TABLE "payables" (
    "id"           SERIAL PRIMARY KEY,
    "supplierName" TEXT          NOT NULL,
    "description"  TEXT          NOT NULL,
    "amount"       DECIMAL(18,2) NOT NULL,
    "taxAmount"    DECIMAL(18,2) NOT NULL DEFAULT 0,
    "issueDate"    TIMESTAMP(3)  NOT NULL,
    "dueDate"      TIMESTAMP(3)  NOT NULL,
    "status"       TEXT          NOT NULL DEFAULT 'open',
    "paidOn"       TIMESTAMP(3),
    "paidAmount"   DECIMAL(18,2),
    "note"         TEXT,
    "createdAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "payables_dueDate_idx" ON "payables"("dueDate");
CREATE INDEX "payables_status_idx"  ON "payables"("status");
