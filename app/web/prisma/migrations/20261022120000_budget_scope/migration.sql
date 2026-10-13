-- 予算の範囲（scope）。家庭（HOUSEHOLD）と個人事業（BUSINESS）で予算・確定・配分を別々に持つ。
-- 既存の予算はすべて家庭。予算の確定は範囲ごと（実績の確定は共通のまま）。
-- 既存のテナントには事業用の配分ルールの初期値を入れる（lib/budget/default-allocation-rules.ts と同じ内容）

-- CreateEnum
CREATE TYPE "BudgetScope" AS ENUM ('HOUSEHOLD', 'BUSINESS');

-- DropIndex
DROP INDEX "allocation_account_assignments_accountId_key";

-- DropIndex
DROP INDEX "allocation_rules_tenantId_key_key";

-- DropIndex
DROP INDEX "budget_confirmations_periodId_key";

-- DropIndex
DROP INDEX "budgets_tenantId_accountId_periodId_key";

-- AlterTable
ALTER TABLE "allocation_account_assignments" ADD COLUMN     "scope" "BudgetScope" NOT NULL DEFAULT 'HOUSEHOLD';

-- AlterTable
ALTER TABLE "allocation_rules" ADD COLUMN     "scope" "BudgetScope" NOT NULL DEFAULT 'HOUSEHOLD';

-- AlterTable
ALTER TABLE "budget_confirmations" ADD COLUMN     "scope" "BudgetScope" NOT NULL DEFAULT 'HOUSEHOLD';

-- AlterTable
ALTER TABLE "budget_histories" ADD COLUMN     "scope" "BudgetScope" NOT NULL DEFAULT 'HOUSEHOLD';

-- AlterTable
ALTER TABLE "budget_items" ADD COLUMN     "scope" "BudgetScope" NOT NULL DEFAULT 'HOUSEHOLD';

-- AlterTable
ALTER TABLE "budgets" ADD COLUMN     "scope" "BudgetScope" NOT NULL DEFAULT 'HOUSEHOLD';

-- CreateIndex
CREATE UNIQUE INDEX "allocation_account_assignments_accountId_scope_key" ON "allocation_account_assignments"("accountId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "allocation_rules_tenantId_scope_key_key" ON "allocation_rules"("tenantId", "scope", "key");

-- CreateIndex
CREATE UNIQUE INDEX "budget_confirmations_periodId_scope_key" ON "budget_confirmations"("periodId", "scope");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_tenantId_scope_accountId_periodId_key" ON "budgets"("tenantId", "scope", "accountId", "periodId");


-- 事業用の配分ルールの初期値（既存のテナント）
INSERT INTO "allocation_rules"
  ("tenantId", "scope", "key", "label", "group", "minPercent", "maxPercent", "note", "fallbackCategory", "keywords", "sortOrder", "updatedAt")
SELECT t."id", 'BUSINESS', d.key, d.label, d."group", d.min_pct, d.max_pct, d.note, d.category::"AccountCategory",
       d.keywords, d.sort_order, CURRENT_TIMESTAMP
FROM "tenants" t
CROSS JOIN (VALUES
  ('purchase', '仕入・材料', '変動費', 20, 40, '売上原価。業種で大きく違うので、実績に合わせて直す', NULL, ARRAY['仕入', '材料', '原価', '商品']::text[], 0),
  ('outsourcing', '外注費', '変動費', 5, 15, NULL, NULL, ARRAY['外注', '業務委託']::text[], 1),
  ('advertising', '広告宣伝費', '変動費', 2, 8, NULL, NULL, ARRAY['広告', '宣伝', '販促']::text[], 2),
  ('travel', '旅費交通費', '変動費', 1, 5, NULL, NULL, ARRAY['旅費', '交通', '出張', 'ガソリン', '駐車']::text[], 3),
  ('supplies', '消耗品費', '変動費', 1, 5, NULL, NULL, ARRAY['消耗品', '事務用品', '備品']::text[], 4),
  ('rent', '地代家賃', '固定費', 5, 15, '自宅兼事務所は事業利用按分した分', NULL, ARRAY['家賃', '地代', '賃料']::text[], 5),
  ('communication', '通信費', '固定費', 1, 5, NULL, NULL, ARRAY['通信', '回線', 'スマホ', '携帯', 'インターネット', 'サーバー']::text[], 6),
  ('utilities', '水道光熱費', '固定費', 1, 3, NULL, NULL, ARRAY['電気', 'ガス', '水道', '光熱']::text[], 7),
  ('entertainment', '接待交際費', 'その他', 0, 4, NULL, NULL, ARRAY['接待', '交際', '会議']::text[], 8),
  ('fees', '支払手数料', 'その他', 0, 4, NULL, NULL, ARRAY['手数料', '振込']::text[], 9),
  ('profit', '事業主の取り分（利益）', 'その他', 20, 32, '生活費・税金・貯蓄に回す分', NULL, ARRAY['貯蓄', '積立', '利益', '事業主']::text[], 10),
  ('other_fixed', 'その他の経費', '固定費', 0, 4, 'どのキーワードにも当たらない経費の科目が入る', 'EXPENSE', ARRAY[]::text[], 11),
  ('other_variable', 'その他の原価', '変動費', 0, 4, 'どのキーワードにも当たらない原価の科目が入る', 'COGS', ARRAY[]::text[], 12)
) AS d(key, label, "group", min_pct, max_pct, note, category, keywords, sort_order)
ON CONFLICT ("tenantId", "scope", "key") DO NOTHING;
