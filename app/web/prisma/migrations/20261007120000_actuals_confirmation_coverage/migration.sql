-- 実績の確定に、確定時点の明細の状況を記録する列を足す。
--
-- 口座・カードごとの明細の最終日と「当月末まで変動なし」の印（lib/actuals-coverage.ts の CoverageSnapshot）。
-- 明細が月末まで届かなくても、変動なしと申告したものはそろったものとして確定できるため、その根拠を残す。
-- この列を足す前に確定した月は NULL のまま。

-- AlterTable
ALTER TABLE "actuals_confirmations" ADD COLUMN "coverage" JSONB;
