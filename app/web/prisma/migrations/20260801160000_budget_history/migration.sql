-- 予算データの変更履歴（budget_histories）。
--
-- 実績には financial_record_histories があるが予算には無く、いつ誰がいくらに変えたのかを
-- 追えなかった。実績管理の「入力履歴」と同じ形で予算管理にも変更履歴タブを設けるための表。
--
-- 予算は削除されても履歴を残したいため budgetId は nullable（削除時 SET NULL）とし、
-- 勘定科目・期間は履歴側に持たせて参照が切れないようにする。

-- CreateTable
CREATE TABLE "budget_histories" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "budgetId" INTEGER,
    "accountId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "userId" INTEGER,
    "action" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_histories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_histories_tenantId_changedAt_idx" ON "budget_histories"("tenantId", "changedAt");

-- CreateIndex
CREATE INDEX "budget_histories_budgetId_idx" ON "budget_histories"("budgetId");

-- AddForeignKey
ALTER TABLE "budget_histories" ADD CONSTRAINT "budget_histories_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_histories" ADD CONSTRAINT "budget_histories_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_histories" ADD CONSTRAINT "budget_histories_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
