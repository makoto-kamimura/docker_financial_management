-- 学習ルールに当てる明細の向き（入金・出金）を持たせる。同じ摘要でも入金（割戻金など）と
-- 出金（掛金など）で科目が違うことがあるため、キーワードと向きの組で一意にする。
-- 既存のルールは ANY（今までどおり入金・出金の両方に当たる）。

-- CreateEnum
CREATE TYPE "RuleFlowSide" AS ENUM ('ANY', 'IN', 'OUT');

-- DropIndex
DROP INDEX "txn_category_rules_tenantId_keyword_key";

-- AlterTable
ALTER TABLE "txn_category_rules" ADD COLUMN     "flowSide" "RuleFlowSide" NOT NULL DEFAULT 'ANY';

-- CreateIndex
CREATE UNIQUE INDEX "txn_category_rules_tenantId_keyword_flowSide_key" ON "txn_category_rules"("tenantId", "keyword", "flowSide");
