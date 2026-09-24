-- 変動金利の履歴（loan_interest_rate_changes）。
-- loans.interestRate は「現在の金利」を保持したまま、変更の都度この表へ1行積む。
-- 過去の金利を保持することで、変動前後の返済スケジュール比較が可能になる。

-- CreateTable
CREATE TABLE "loan_interest_rate_changes" (
    "id" SERIAL NOT NULL,
    "loanId" INTEGER NOT NULL,
    "effectiveOn" TIMESTAMP(3) NOT NULL,
    "interestRate" DECIMAL(5,4) NOT NULL,
    "previousRate" DECIMAL(5,4) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loan_interest_rate_changes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loan_interest_rate_changes_loanId_idx" ON "loan_interest_rate_changes"("loanId");

-- CreateIndex
CREATE UNIQUE INDEX "loan_interest_rate_changes_loanId_effectiveOn_key" ON "loan_interest_rate_changes"("loanId", "effectiveOn");

-- AddForeignKey
ALTER TABLE "loan_interest_rate_changes" ADD CONSTRAINT "loan_interest_rate_changes_loanId_fkey" FOREIGN KEY ("loanId") REFERENCES "loans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
