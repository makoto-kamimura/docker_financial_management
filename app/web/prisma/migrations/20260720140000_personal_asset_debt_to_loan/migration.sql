-- D-4: 借入表現の一本化
-- personal_assets の負債フィールド（debtStartOn/debtPayoffDue/debtInitialAmount）を loans へ移行し、
-- personal_assets.loanId（unique FK）で参照する。

-- 1. personal_assets に loanId を追加
ALTER TABLE "personal_assets" ADD COLUMN "loanId" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "personal_assets_loanId_key" ON "personal_assets"("loanId");

-- AddForeignKey
ALTER TABLE "personal_assets" ADD CONSTRAINT "personal_assets_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- 2. 負債フィールドを持つ既存資産から loans 行を生成する。
--    monthly / remaining の計算は lib/debt-schedule.ts の computeDebtSchedule() と同一式:
--      totalMonths = (payoffYm - startYm) + 1（月初日で保存されている前提の年月インデックス差）
--      monthly     = round(amount / totalMonths)
--      paidMonths  = clamp(nowYm - startYm + 1, 0, totalMonths)
--      remaining   = paidMonths >= totalMonths ? 0 : max(0, amount - monthly * paidMonths)
ALTER TABLE "loans" ADD COLUMN "_migAssetId" INTEGER;

INSERT INTO "loans"
  ("tenantId", "lenderName", "amount", "interestRate", "borrowedOn", "repaymentDate",
   "remainingAmount", "status", "note", "loanType", "monthlyPayment", "updatedAt", "_migAssetId")
SELECT
  pa."tenantId",
  pa."name",
  pa."debtInitialAmount",
  0,
  pa."debtStartOn",
  pa."debtPayoffDue",
  calc."remaining",
  CASE WHEN calc."remaining" > 0 THEN 'active' ELSE 'repaid' END,
  '実物資産「' || pa."name" || '」の紐付け負債（D-4 移行）',
  'asset',
  calc."monthly",
  CURRENT_TIMESTAMP,
  pa."id"
FROM "personal_assets" pa
CROSS JOIN LATERAL (
  SELECT
    total_months,
    ROUND(pa."debtInitialAmount" / total_months) AS "monthly",
    CASE
      WHEN paid_months >= total_months THEN 0
      ELSE GREATEST(0, pa."debtInitialAmount" - ROUND(pa."debtInitialAmount" / total_months) * paid_months)
    END AS "remaining"
  FROM (
    SELECT
      (EXTRACT(YEAR FROM pa."debtPayoffDue")::int * 12 + EXTRACT(MONTH FROM pa."debtPayoffDue")::int)
        - (EXTRACT(YEAR FROM pa."debtStartOn")::int * 12 + EXTRACT(MONTH FROM pa."debtStartOn")::int)
        + 1 AS total_months,
      LEAST(
        GREATEST(
          (EXTRACT(YEAR FROM CURRENT_DATE)::int * 12 + EXTRACT(MONTH FROM CURRENT_DATE)::int)
            - (EXTRACT(YEAR FROM pa."debtStartOn")::int * 12 + EXTRACT(MONTH FROM pa."debtStartOn")::int)
            + 1,
          0
        ),
        (EXTRACT(YEAR FROM pa."debtPayoffDue")::int * 12 + EXTRACT(MONTH FROM pa."debtPayoffDue")::int)
          - (EXTRACT(YEAR FROM pa."debtStartOn")::int * 12 + EXTRACT(MONTH FROM pa."debtStartOn")::int)
          + 1
      ) AS paid_months
  ) AS ym
) AS calc
WHERE pa."debtInitialAmount" IS NOT NULL
  AND pa."debtInitialAmount" > 0
  AND pa."debtStartOn" IS NOT NULL
  AND pa."debtPayoffDue" IS NOT NULL
  AND calc.total_months > 0;

UPDATE "personal_assets" pa
SET "loanId" = l."id"
FROM "loans" l
WHERE l."_migAssetId" = pa."id";

ALTER TABLE "loans" DROP COLUMN "_migAssetId";

-- 3. 旧負債フィールドを撤去
ALTER TABLE "personal_assets" DROP COLUMN "debtStartOn";
ALTER TABLE "personal_assets" DROP COLUMN "debtPayoffDue";
ALTER TABLE "personal_assets" DROP COLUMN "debtInitialAmount";
