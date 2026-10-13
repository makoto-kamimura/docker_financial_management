-- 口座・カード・電子マネー・実物資産・借入金の事業利用。個人事業主モードでは事業利用のものだけを出す。
-- 事業利用の口座・カードに入る明細は、事業利用で入る（lib/ledger/ledger-entries.ts）。既存はすべて事業利用なし

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "businessUse" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "linked_accounts" ADD COLUMN     "businessUse" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "loans" ADD COLUMN     "businessUse" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "personal_assets" ADD COLUMN     "businessUse" BOOLEAN NOT NULL DEFAULT false;

