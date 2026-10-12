-- テナントに期の開始月（期首月）を持たせる。
--   - 開始月は決算月の翌月（決算 3 月なら 4 月、決算 12 月なら 1 月）でなければならない。CHECK 制約で保証する
--   - 既存のテナントは決算月から求めた値を入れる

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN "startMonth" INTEGER NOT NULL DEFAULT 1;

UPDATE "tenants" SET "startMonth" = ("closingMonth" % 12) + 1;

ALTER TABLE "tenants" ADD CONSTRAINT "tenants_start_month_follows_closing"
  CHECK ("startMonth" = ("closingMonth" % 12) + 1);
