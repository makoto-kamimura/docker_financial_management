-- D-2: 会計年度の開閉状態の一本化
-- fiscal_year_closes を fiscal_years へマージし、テーブルを削除する。

-- 1. fiscal_years に統合先カラムを追加
ALTER TABLE "fiscal_years" ADD COLUMN "netIncome" DECIMAL(18,2);
ALTER TABLE "fiscal_years" ADD COLUMN "closedAt" TIMESTAMP(3);

-- 2. 既存の fiscal_years 行に締め状態をマージ（tenantId + year で一致するもの）
UPDATE "fiscal_years" fy
SET "status" = fyc."status",
    "netIncome" = fyc."netIncome",
    "closedAt" = fyc."closedAt"
FROM "fiscal_year_closes" fyc
WHERE fyc."tenantId" = fy."tenantId"
  AND fyc."fiscalYear" = fy."year";

-- 3. 対応する fiscal_years 行が存在しない fiscal_year_closes は、暦年（1/1〜12/31）で新規作成する
--    （このアプリの fiscalYear は Period.fiscalYear と同じ「暦年」の整数として扱われており、
--     決算月からの導出規則がコード上に存在しないため、フォールバックとして暦年を採用する）
INSERT INTO "fiscal_years" ("tenantId", "year", "startDate", "endDate", "status", "netIncome", "closedAt", "updatedAt")
SELECT
  fyc."tenantId",
  fyc."fiscalYear",
  make_date(fyc."fiscalYear", 1, 1),
  make_date(fyc."fiscalYear", 12, 31),
  fyc."status",
  fyc."netIncome",
  fyc."closedAt",
  CURRENT_TIMESTAMP
FROM "fiscal_year_closes" fyc
WHERE NOT EXISTS (
  SELECT 1 FROM "fiscal_years" fy
  WHERE fy."tenantId" = fyc."tenantId" AND fy."year" = fyc."fiscalYear"
);

-- 4. 旧テーブルを削除
DROP TABLE "fiscal_year_closes";
