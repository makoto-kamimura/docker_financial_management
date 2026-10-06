-- 予算管理のカレンダーで登録する予算の 1 件（セルの内訳）。
-- 登録すると同じ科目・月の budgets.amount に足し、削除すると引く。budgets は科目×月で 1 行のまま変えない。

-- CreateTable
CREATE TABLE "budget_items" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "accountId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "description" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "createdById" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "budget_items_tenantId_periodId_idx" ON "budget_items"("tenantId", "periodId");

-- CreateIndex
CREATE INDEX "budget_items_accountId_periodId_idx" ON "budget_items"("accountId", "periodId");

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_items" ADD CONSTRAINT "budget_items_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
