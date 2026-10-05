-- 実績の確定（actuals_confirmations）。
--
-- 月ごとの流れ「予算確定 → 実績確定 → 翌月の予算確定」の真ん中の段。
-- 行がある月の実績（financial_records）は確定済みで、登録・変更・削除・明細の転記を受け付けない。
-- period は tenant ごとに作られるため periodId だけで一意になる。

-- CreateTable
CREATE TABLE "actuals_confirmations" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "confirmedById" INTEGER,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "actuals_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "actuals_confirmations_periodId_key" ON "actuals_confirmations"("periodId");

-- CreateIndex
CREATE INDEX "actuals_confirmations_tenantId_idx" ON "actuals_confirmations"("tenantId");

-- AddForeignKey
ALTER TABLE "actuals_confirmations" ADD CONSTRAINT "actuals_confirmations_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
