-- 口座残高に「明細に現れない差額」を持たせる。
--
-- 背景: 残高を SUM(bank_transactions.amount) だけで算出していたため、CSV の取込開始前から
-- 口座にあった残高（期首残高）が抜け、実際の残高と一致しなかった（住信SBI が −362,619 円と
-- 表示されるなど）。同じ計算を口座サマリ・総資産サマリ・資金繰り・残高推移グラフが共有しており、
-- すべて同額ずれていた。
--
-- 対応: balanceAdjustment に差額を入力できるようにし、残高 = SUM(amount) + balanceAdjustment とする。
-- 既定値 0 のため、未入力の口座は従来と同じ値になる（移行時点の表示は不変）。

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN "balanceAdjustment" DECIMAL(18,2) NOT NULL DEFAULT 0;
