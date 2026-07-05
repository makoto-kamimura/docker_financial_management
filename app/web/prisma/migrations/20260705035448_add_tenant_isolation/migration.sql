-- CreateEnum
CREATE TYPE "AccountMappingMatchType" AS ENUM ('TABLE', 'KEYWORD', 'FUZZY', 'AI_FREE', 'AI_PAID', 'MANUAL');

-- CreateEnum
CREATE TYPE "AccountConversionMode" AS ENUM ('HOME', 'CORPORATE');

-- CreateEnum
CREATE TYPE "AccountConversionStatus" AS ENUM ('COMPLETED', 'CANCELLED');

-- DropForeignKey
ALTER TABLE "accrued_expenses" DROP CONSTRAINT "accrued_expenses_accountId_fkey";

-- DropForeignKey
ALTER TABLE "accrued_revenues" DROP CONSTRAINT "accrued_revenues_accountId_fkey";

-- DropForeignKey
ALTER TABLE "announcements" DROP CONSTRAINT "announcements_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "apportionments" DROP CONSTRAINT "apportionments_accountId_fkey";

-- DropForeignKey
ALTER TABLE "depreciations" DROP CONSTRAINT "depreciations_fixedAssetId_fkey";

-- DropForeignKey
ALTER TABLE "dividends" DROP CONSTRAINT "dividends_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "fiscal_years" DROP CONSTRAINT "fiscal_years_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "inventory_items" DROP CONSTRAINT "inventory_items_inventoryId_fkey";

-- DropForeignKey
ALTER TABLE "invoice_lines" DROP CONSTRAINT "invoice_lines_invoiceId_fkey";

-- DropForeignKey
ALTER TABLE "journal_approvals" DROP CONSTRAINT "journal_approvals_actorId_fkey";

-- DropForeignKey
ALTER TABLE "journal_approvals" DROP CONSTRAINT "journal_approvals_journalEntryId_fkey";

-- DropForeignKey
ALTER TABLE "journal_details" DROP CONSTRAINT "journal_details_accountId_fkey";

-- DropForeignKey
ALTER TABLE "journal_details" DROP CONSTRAINT "journal_details_journalEntryId_fkey";

-- DropForeignKey
ALTER TABLE "journal_template_lines" DROP CONSTRAINT "journal_template_lines_accountId_fkey";

-- DropForeignKey
ALTER TABLE "journal_template_lines" DROP CONSTRAINT "journal_template_lines_templateId_fkey";

-- DropForeignKey
ALTER TABLE "loan_repayments" DROP CONSTRAINT "loan_repayments_loanId_fkey";

-- DropForeignKey
ALTER TABLE "officers" DROP CONSTRAINT "officers_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "receipts" DROP CONSTRAINT "receipts_journalEntryId_fkey";

-- DropForeignKey
ALTER TABLE "shareholder_meetings" DROP CONSTRAINT "shareholder_meetings_tenantId_fkey";

-- DropIndex
DROP INDEX "accounts_code_key";

-- DropIndex
ALTER TABLE "apportionments" DROP CONSTRAINT "apportionments_accountId_key";

-- DropIndex
DROP INDEX "budgets_accountId_periodId_key";

-- DropIndex
DROP INDEX "financial_records_accountId_periodId_idx";

-- DropIndex
ALTER TABLE "fiscal_year_closes" DROP CONSTRAINT "fiscal_year_closes_fiscalYear_key";

-- DropIndex
DROP INDEX "inventories_inventoryDate_idx";

-- DropIndex
ALTER TABLE "invoices" DROP CONSTRAINT "invoices_invoiceNumber_key";

-- DropIndex
DROP INDEX "journal_entries_approvalStatus_idx";

-- DropIndex
DROP INDEX "journal_entries_transactionDate_idx";

-- DropIndex
DROP INDEX "payables_dueDate_idx";

-- DropIndex
DROP INDEX "payables_status_idx";

-- DropIndex
DROP INDEX "periods_fiscalYear_month_key";

-- DropIndex
DROP INDEX "receivables_dueDate_idx";

-- DropIndex
DROP INDEX "receivables_status_idx";

-- DropIndex
ALTER TABLE "tax_settings" DROP CONSTRAINT "tax_settings_taxYear_key";

-- AlterTable
ALTER TABLE "accounts" ADD COLUMN     "tenantId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "accrued_expenses" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "accrued_revenues" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "announcements" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "apportionments" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "bank_accounts" DROP COLUMN "accountNumber",
DROP COLUMN "balance",
DROP COLUMN "updatedAt",
ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "accountType" SET DEFAULT '普通';

-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "tenantId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "business_profiles" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "departments" ADD COLUMN     "tenantId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "dividends" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "financial_records" ADD COLUMN     "tenantId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "fiscal_year_closes" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "fiscal_years" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "fixed_assets" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "forecasts" ADD COLUMN     "tenantId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "inventories" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "inventory_items" ALTER COLUMN "quantity" DROP DEFAULT,
ALTER COLUMN "unitPrice" DROP DEFAULT,
ALTER COLUMN "totalAmount" DROP DEFAULT;

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "journal_approvals" ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "journal_entries" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "journal_templates" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "linked_accounts" ADD COLUMN     "tenantId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "officers" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "payables" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "periods" ADD COLUMN     "tenantId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "receipts" ALTER COLUMN "fileType" DROP DEFAULT,
ALTER COLUMN "fileSize" DROP DEFAULT;

-- AlterTable
ALTER TABLE "receivables" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "shareholder_meetings" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tax_settings" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "tenants" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "transfers" ADD COLUMN     "tenantId" INTEGER NOT NULL;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "tenantId" INTEGER NOT NULL,
ALTER COLUMN "lockedUntil" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "account_mapping_rules" (
    "id" SERIAL NOT NULL,
    "homeCode" TEXT NOT NULL,
    "corporateCode" TEXT,
    "matchType" "AccountMappingMatchType" NOT NULL DEFAULT 'TABLE',
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "isConvertible" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "userId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "account_mapping_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_conversion_sessions" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "fromMode" "AccountConversionMode" NOT NULL,
    "toMode" "AccountConversionMode" NOT NULL,
    "convertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "status" "AccountConversionStatus" NOT NULL DEFAULT 'COMPLETED',

    CONSTRAINT "account_conversion_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "account_conversion_logs" (
    "id" SERIAL NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "homeAccountId" INTEGER NOT NULL,
    "corporateAccountId" INTEGER,
    "matchType" "AccountMappingMatchType" NOT NULL,
    "confidenceScore" DOUBLE PRECISION,
    "isConvertible" BOOLEAN NOT NULL DEFAULT true,
    "isManuallyOverridden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "account_conversion_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversion_results" (
    "id" SERIAL NOT NULL,
    "cacheKey" TEXT NOT NULL,
    "inputContext" JSONB NOT NULL,
    "primaryCode" TEXT NOT NULL,
    "primaryReason" TEXT NOT NULL,
    "taxClassification" TEXT NOT NULL,
    "taxNotes" TEXT,
    "alternatives" JSONB NOT NULL,
    "confidenceScore" DOUBLE PRECISION NOT NULL,
    "confidenceReason" TEXT NOT NULL,
    "warnings" JSONB NOT NULL,
    "modelId" TEXT NOT NULL,
    "cachedUntil" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_conversion_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_conversion_usages" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "sessionId" INTEGER NOT NULL,
    "accountCount" INTEGER NOT NULL,
    "cachedCount" INTEGER NOT NULL,
    "billedCount" INTEGER NOT NULL,
    "plan" TEXT NOT NULL,
    "chargedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reportGenerated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ai_conversion_usages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "account_mapping_rules_homeCode_idx" ON "account_mapping_rules"("homeCode");

-- CreateIndex
CREATE INDEX "account_mapping_rules_userId_idx" ON "account_mapping_rules"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "account_mapping_rules_homeCode_userId_key" ON "account_mapping_rules"("homeCode", "userId");

-- CreateIndex
CREATE INDEX "account_conversion_sessions_userId_idx" ON "account_conversion_sessions"("userId");

-- CreateIndex
CREATE INDEX "account_conversion_logs_sessionId_idx" ON "account_conversion_logs"("sessionId");

-- CreateIndex
CREATE UNIQUE INDEX "ai_conversion_results_cacheKey_key" ON "ai_conversion_results"("cacheKey");

-- CreateIndex
CREATE INDEX "ai_conversion_usages_userId_idx" ON "ai_conversion_usages"("userId");

-- CreateIndex
CREATE INDEX "ai_conversion_usages_sessionId_idx" ON "ai_conversion_usages"("sessionId");

-- CreateIndex
CREATE INDEX "accounts_tenantId_idx" ON "accounts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_tenantId_code_key" ON "accounts"("tenantId", "code");

-- CreateIndex
CREATE INDEX "accrued_expenses_tenantId_idx" ON "accrued_expenses"("tenantId");

-- CreateIndex
CREATE INDEX "accrued_revenues_tenantId_idx" ON "accrued_revenues"("tenantId");

-- CreateIndex
CREATE INDEX "apportionments_tenantId_idx" ON "apportionments"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "apportionments_tenantId_accountId_key" ON "apportionments"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "bank_accounts_tenantId_idx" ON "bank_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "budgets_tenantId_idx" ON "budgets"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_tenantId_accountId_periodId_key" ON "budgets"("tenantId", "accountId", "periodId");

-- CreateIndex
CREATE UNIQUE INDEX "business_profiles_tenantId_key" ON "business_profiles"("tenantId");

-- CreateIndex
CREATE INDEX "departments_tenantId_idx" ON "departments"("tenantId");

-- CreateIndex
CREATE INDEX "financial_records_tenantId_accountId_periodId_idx" ON "financial_records"("tenantId", "accountId", "periodId");

-- CreateIndex
CREATE INDEX "fiscal_year_closes_tenantId_idx" ON "fiscal_year_closes"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_year_closes_tenantId_fiscalYear_key" ON "fiscal_year_closes"("tenantId", "fiscalYear");

-- CreateIndex
CREATE INDEX "fixed_assets_tenantId_idx" ON "fixed_assets"("tenantId");

-- CreateIndex
CREATE INDEX "forecasts_tenantId_idx" ON "forecasts"("tenantId");

-- CreateIndex
CREATE INDEX "inventories_tenantId_inventoryDate_idx" ON "inventories"("tenantId", "inventoryDate");

-- CreateIndex
CREATE INDEX "invoices_tenantId_idx" ON "invoices"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_tenantId_invoiceNumber_key" ON "invoices"("tenantId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "journal_entries_tenantId_transactionDate_idx" ON "journal_entries"("tenantId", "transactionDate");

-- CreateIndex
CREATE INDEX "journal_entries_tenantId_approvalStatus_idx" ON "journal_entries"("tenantId", "approvalStatus");

-- CreateIndex
CREATE INDEX "journal_templates_tenantId_idx" ON "journal_templates"("tenantId");

-- CreateIndex
CREATE INDEX "linked_accounts_tenantId_idx" ON "linked_accounts"("tenantId");

-- CreateIndex
CREATE INDEX "loans_tenantId_idx" ON "loans"("tenantId");

-- CreateIndex
CREATE INDEX "payables_tenantId_dueDate_idx" ON "payables"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "payables_tenantId_status_idx" ON "payables"("tenantId", "status");

-- CreateIndex
CREATE INDEX "periods_tenantId_idx" ON "periods"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "periods_tenantId_fiscalYear_month_key" ON "periods"("tenantId", "fiscalYear", "month");

-- CreateIndex
CREATE INDEX "receivables_tenantId_dueDate_idx" ON "receivables"("tenantId", "dueDate");

-- CreateIndex
CREATE INDEX "receivables_tenantId_status_idx" ON "receivables"("tenantId", "status");

-- CreateIndex
CREATE INDEX "tax_settings_tenantId_idx" ON "tax_settings"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "tax_settings_tenantId_taxYear_key" ON "tax_settings"("tenantId", "taxYear");

-- CreateIndex
CREATE INDEX "transfers_tenantId_idx" ON "transfers"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "users_tenantId_key" ON "users"("tenantId");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_approvals" ADD CONSTRAINT "journal_approvals_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_approvals" ADD CONSTRAINT "journal_approvals_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_details" ADD CONSTRAINT "journal_details_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_details" ADD CONSTRAINT "journal_details_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_inventoryId_fkey" FOREIGN KEY ("inventoryId") REFERENCES "inventories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "depreciations" ADD CONSTRAINT "depreciations_fixedAssetId_fkey" FOREIGN KEY ("fixedAssetId") REFERENCES "fixed_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apportionments" ADD CONSTRAINT "apportionments_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fiscal_years" ADD CONSTRAINT "fiscal_years_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_template_lines" ADD CONSTRAINT "journal_template_lines_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "journal_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_template_lines" ADD CONSTRAINT "journal_template_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loan_repayments" ADD CONSTRAINT "loan_repayments_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accrued_revenues" ADD CONSTRAINT "accrued_revenues_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accrued_expenses" ADD CONSTRAINT "accrued_expenses_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "officers" ADD CONSTRAINT "officers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "shareholder_meetings" ADD CONSTRAINT "shareholder_meetings_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dividends" ADD CONSTRAINT "dividends_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "announcements" ADD CONSTRAINT "announcements_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "account_conversion_logs" ADD CONSTRAINT "account_conversion_logs_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "account_conversion_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

