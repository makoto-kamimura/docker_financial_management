-- Phase 1: テナント・会計年度
CREATE TABLE "tenants" (
  "id"              SERIAL PRIMARY KEY,
  "type"            TEXT NOT NULL DEFAULT 'SOLE_PROPRIETOR',
  "name"            TEXT NOT NULL,
  "corporateNumber" TEXT,
  "capitalAmount"   DECIMAL(18,2),
  "establishedOn"   TIMESTAMP(3),
  "closingMonth"    INTEGER NOT NULL DEFAULT 12,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "fiscal_years" (
  "id"        SERIAL PRIMARY KEY,
  "tenantId"  INTEGER NOT NULL,
  "year"      INTEGER NOT NULL,
  "startDate" TIMESTAMP(3) NOT NULL,
  "endDate"   TIMESTAMP(3) NOT NULL,
  "status"    TEXT NOT NULL DEFAULT 'open',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "fiscal_years_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE,
  CONSTRAINT "fiscal_years_tenantId_year_key" UNIQUE ("tenantId", "year")
);

-- Phase 2: 仕訳テンプレート
CREATE TABLE "journal_templates" (
  "id"          SERIAL PRIMARY KEY,
  "name"        TEXT NOT NULL,
  "description" TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "journal_template_lines" (
  "id"         SERIAL PRIMARY KEY,
  "templateId" INTEGER NOT NULL,
  "side"       TEXT NOT NULL,
  "accountId"  INTEGER NOT NULL,
  "amount"     DECIMAL(18,2),
  "note"       TEXT,
  "sortOrder"  INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "journal_template_lines_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "journal_templates"("id") ON DELETE CASCADE,
  CONSTRAINT "journal_template_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
);

-- Phase 3: 銀行口座・借入金
CREATE TABLE "bank_accounts" (
  "id"            SERIAL PRIMARY KEY,
  "name"          TEXT NOT NULL,
  "bankName"      TEXT NOT NULL,
  "branchName"    TEXT,
  "accountType"   TEXT NOT NULL DEFAULT 'ORDINARY',
  "accountNumber" TEXT,
  "balance"       DECIMAL(18,2) NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "bank_transactions" (
  "id"              SERIAL PRIMARY KEY,
  "bankAccountId"   INTEGER NOT NULL,
  "transactionDate" TIMESTAMP(3) NOT NULL,
  "description"     TEXT NOT NULL,
  "amount"          DECIMAL(18,2) NOT NULL,
  "balanceAfter"    DECIMAL(18,2) NOT NULL,
  "category"        TEXT,
  "reconciled"      BOOLEAN NOT NULL DEFAULT false,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bank_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE
);
CREATE INDEX "bank_transactions_bankAccountId_idx" ON "bank_transactions"("bankAccountId");
CREATE INDEX "bank_transactions_transactionDate_idx" ON "bank_transactions"("transactionDate");

CREATE TABLE "loans" (
  "id"              SERIAL PRIMARY KEY,
  "lenderName"      TEXT NOT NULL,
  "amount"          DECIMAL(18,2) NOT NULL,
  "interestRate"    DECIMAL(5,4) NOT NULL,
  "borrowedOn"      TIMESTAMP(3) NOT NULL,
  "repaymentDate"   TIMESTAMP(3) NOT NULL,
  "remainingAmount" DECIMAL(18,2) NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'active',
  "note"            TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "loan_repayments" (
  "id"          SERIAL PRIMARY KEY,
  "loanId"      INTEGER NOT NULL,
  "repaidOn"    TIMESTAMP(3) NOT NULL,
  "principal"   DECIMAL(18,2) NOT NULL,
  "interest"    DECIMAL(18,2) NOT NULL,
  "totalAmount" DECIMAL(18,2) NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "loan_repayments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE
);
CREATE INDEX "loan_repayments_loanId_idx" ON "loan_repayments"("loanId");

-- Phase 4: インボイス
CREATE TABLE "invoices" (
  "id"              SERIAL PRIMARY KEY,
  "invoiceNumber"   TEXT NOT NULL UNIQUE,
  "customerName"    TEXT NOT NULL,
  "customerAddress" TEXT,
  "issueDate"       TIMESTAMP(3) NOT NULL,
  "dueDate"         TIMESTAMP(3) NOT NULL,
  "status"          TEXT NOT NULL DEFAULT 'draft',
  "subtotal"        DECIMAL(18,2) NOT NULL,
  "taxAmount"       DECIMAL(18,2) NOT NULL,
  "total"           DECIMAL(18,2) NOT NULL,
  "note"            TEXT,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "invoice_lines" (
  "id"          SERIAL PRIMARY KEY,
  "invoiceId"   INTEGER NOT NULL,
  "description" TEXT NOT NULL,
  "quantity"    DECIMAL(10,3) NOT NULL,
  "unitPrice"   DECIMAL(18,2) NOT NULL,
  "taxRate"     DECIMAL(5,4) NOT NULL DEFAULT 0.10,
  "amount"      DECIMAL(18,2) NOT NULL,
  CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE
);

-- Phase 5: 決算整理
CREATE TABLE "accrued_revenues" (
  "id"          SERIAL PRIMARY KEY,
  "description" TEXT NOT NULL,
  "amount"      DECIMAL(18,2) NOT NULL,
  "accrualDate" TIMESTAMP(3) NOT NULL,
  "accountId"   INTEGER NOT NULL,
  "fiscalYear"  INTEGER NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'pending',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accrued_revenues_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
);

CREATE TABLE "accrued_expenses" (
  "id"          SERIAL PRIMARY KEY,
  "description" TEXT NOT NULL,
  "amount"      DECIMAL(18,2) NOT NULL,
  "accrualDate" TIMESTAMP(3) NOT NULL,
  "accountId"   INTEGER NOT NULL,
  "fiscalYear"  INTEGER NOT NULL,
  "status"      TEXT NOT NULL DEFAULT 'pending',
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "accrued_expenses_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id")
);

-- Phase 6: 法人ガバナンス
CREATE TABLE "officers" (
  "id"        SERIAL PRIMARY KEY,
  "tenantId"  INTEGER NOT NULL,
  "name"      TEXT NOT NULL,
  "title"     TEXT NOT NULL,
  "termStart" TIMESTAMP(3) NOT NULL,
  "termEnd"   TIMESTAMP(3) NOT NULL,
  "salary"    DECIMAL(18,2),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "officers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE TABLE "shareholder_meetings" (
  "id"          SERIAL PRIMARY KEY,
  "tenantId"    INTEGER NOT NULL,
  "meetingDate" TIMESTAMP(3) NOT NULL,
  "meetingType" TEXT NOT NULL DEFAULT 'regular',
  "agenda"      TEXT NOT NULL,
  "resolution"  TEXT,
  "minutesUrl"  TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "shareholder_meetings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE TABLE "dividends" (
  "id"             SERIAL PRIMARY KEY,
  "tenantId"       INTEGER NOT NULL,
  "resolutionDate" TIMESTAMP(3) NOT NULL,
  "paymentDate"    TIMESTAMP(3) NOT NULL,
  "perShareAmount" DECIMAL(18,4) NOT NULL,
  "totalAmount"    DECIMAL(18,2) NOT NULL,
  "note"           TEXT,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dividends_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);

CREATE TABLE "announcements" (
  "id"               SERIAL PRIMARY KEY,
  "tenantId"         INTEGER NOT NULL,
  "announcementDate" TIMESTAMP(3) NOT NULL,
  "method"           TEXT NOT NULL DEFAULT 'WEBSITE',
  "content"          TEXT,
  "fiscalYear"       INTEGER NOT NULL,
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "announcements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE
);
