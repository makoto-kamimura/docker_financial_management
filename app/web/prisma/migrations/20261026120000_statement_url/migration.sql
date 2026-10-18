-- 銀行口座・カード（電子マネー）の明細を見る公式サイトの URL。CSV インポートの画面から開く。

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "statementUrl" TEXT;

-- AlterTable
ALTER TABLE "linked_accounts" ADD COLUMN     "statementUrl" TEXT;
