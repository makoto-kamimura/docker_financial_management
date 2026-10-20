-- 自動車ローン返済の科目を家庭モードの既定科目へ追加する（20261023120000_tax_return のふるさと納税と同じ方法）。
-- カーローンの返済の引き落とし明細と、借入金管理の予算連携先に使う（負債の H-4002 は明細に付けられないため）。
-- 新規テナントは lib/accounting/default-accounts.ts から作られるため、既に家庭モード科目（H-*）を
-- 使っている既存テナントへ後から入れる。同じコードがあれば何もしない（再実行しても安全）。
INSERT INTO "accounts" ("tenantId", "code", "name", "category", "soleName", "corporateName", "createdAt", "updatedAt")
SELECT t."id", 'H-3040', '自動車ローン返済', 'EXPENSE'::"AccountCategory", '❌（個人負債の返済）', '長期借入金（元金）/ 支払利息', NOW(), NOW()
FROM "tenants" t
WHERE EXISTS (
  SELECT 1 FROM "accounts" a2 WHERE a2."tenantId" = t."id" AND a2."code" LIKE 'H-%'
)
AND NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."tenantId" = t."id" AND a."code" = 'H-3040'
);
