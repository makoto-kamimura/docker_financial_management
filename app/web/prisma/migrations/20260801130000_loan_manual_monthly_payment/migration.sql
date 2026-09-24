-- 変動金利の返済額を「実額（金融機関の通知額）」で持てるようにする。
--
-- 背景: 変動金利型住宅ローンの多くは 5 年ルール（金利が変わっても 5 年間は返済額を据え置き、
-- 元本と利息の内訳だけが変わる）を採るため、金利から機械的に計算した月額と実際の請求額は
-- 一致しない。従来は Loan.monthlyPayment を自動計算で上書きしていたため、金利改定のたびに
-- 実額から乖離していた。
--
-- 対応:
--   loans.monthlyPaymentIsManual … 実額が入力済みかどうか。true の間は自動計算が上書きしない
--   loan_interest_rate_changes.monthlyPayment           … 改定後の実額（null = 入力待ち）
--   loan_interest_rate_changes.previousMonthlyPayment   … 改定直前の月額（旧金利時の月額）
--   loan_interest_rate_changes.calculatedMonthlyPayment … 残高 × 残回数 で算出した参考値

-- AlterTable
ALTER TABLE "loans" ADD COLUMN "monthlyPaymentIsManual" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "loan_interest_rate_changes" ADD COLUMN "monthlyPayment" DECIMAL(18,2);
ALTER TABLE "loan_interest_rate_changes" ADD COLUMN "previousMonthlyPayment" DECIMAL(18,2);
ALTER TABLE "loan_interest_rate_changes" ADD COLUMN "calculatedMonthlyPayment" DECIMAL(18,2);
