-- 給与明細に載る科目（手当・社会保険の内訳）を家庭モードの既定科目へ追加する。
-- 新規テナントは lib/default-accounts.ts の HOME_ACCOUNTS_SEED から作成されるため、
-- ここでは「既に家庭モード科目（H-*）を使っている既存テナント」へ後追いで投入する。
-- 同じコードが既にある場合は何もしない（再実行しても安全）。
INSERT INTO "accounts" ("tenantId", "code", "name", "category", "soleName", "corporateName", "createdAt", "updatedAt")
SELECT t."id", v."code", v."name", v."category"::"AccountCategory", v."name", v."name", NOW(), NOW()
FROM "tenants" t
CROSS JOIN (
  VALUES
    ('H-1017', '通勤手当', 'REVENUE'),
    ('H-1018', '残業手当', 'REVENUE'),
    ('H-1019', '住宅手当・家族手当', 'REVENUE'),
    ('H-3035', '健康保険料', 'EXPENSE'),
    ('H-3036', '介護保険料', 'EXPENSE'),
    ('H-3037', '厚生年金保険料', 'EXPENSE'),
    ('H-3038', '雇用保険料', 'EXPENSE')
) AS v("code", "name", "category")
WHERE EXISTS (
  SELECT 1 FROM "accounts" a2 WHERE a2."tenantId" = t."id" AND a2."code" LIKE 'H-%'
)
AND NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."tenantId" = t."id" AND a."code" = v."code"
);
