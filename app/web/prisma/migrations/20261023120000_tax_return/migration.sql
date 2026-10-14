-- 控除・確定申告のページ: 年ごとの入力と、所得税・住民税の控除額などの上書き
CREATE TABLE "tax_return_inputs" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "inputs" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_return_inputs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tax_rule_overrides" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tax_rule_overrides_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tax_return_inputs_tenantId_idx" ON "tax_return_inputs"("tenantId");
CREATE UNIQUE INDEX "tax_return_inputs_tenantId_taxYear_key" ON "tax_return_inputs"("tenantId", "taxYear");
CREATE INDEX "tax_rule_overrides_tenantId_idx" ON "tax_rule_overrides"("tenantId");
CREATE UNIQUE INDEX "tax_rule_overrides_tenantId_taxYear_key" ON "tax_rule_overrides"("tenantId", "taxYear");

-- ふるさと納税の科目を家庭モードの既定科目へ追加する（20260801120000_payslip_default_accounts と同じ方法）。
-- 新規テナントは lib/accounting/default-accounts.ts から作られるため、既に家庭モード科目（H-*）を
-- 使っている既存テナントへ後から入れる。同じコードがあれば何もしない（再実行しても安全）。
INSERT INTO "accounts" ("tenantId", "code", "name", "category", "soleName", "corporateName", "createdAt", "updatedAt")
SELECT t."id", 'H-3039', 'ふるさと納税', 'EXPENSE'::"AccountCategory", '❌（寄附金控除）', '寄付金', NOW(), NOW()
FROM "tenants" t
WHERE EXISTS (
  SELECT 1 FROM "accounts" a2 WHERE a2."tenantId" = t."id" AND a2."code" LIKE 'H-%'
)
AND NOT EXISTS (
  SELECT 1 FROM "accounts" a WHERE a."tenantId" = t."id" AND a."code" = 'H-3039'
);
