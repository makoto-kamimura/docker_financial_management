-- 予算の確定（budget_confirmations）。
--
-- 予算と実績を月ごとに比べ、差額をもとに翌月の予算案を作って確定する流れのための表。
-- 行がある月の予算は確定済みで、予実対比の基準として固定する（編集を受け付けない）。
-- period は tenant ごとに作られるため periodId だけで一意になる。

-- CreateTable
CREATE TABLE "budget_confirmations" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "periodId" INTEGER NOT NULL,
    "confirmedById" INTEGER,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_confirmations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "budget_confirmations_periodId_key" ON "budget_confirmations"("periodId");

-- CreateIndex
CREATE INDEX "budget_confirmations_tenantId_idx" ON "budget_confirmations"("tenantId");

-- AddForeignKey
ALTER TABLE "budget_confirmations" ADD CONSTRAINT "budget_confirmations_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "periods"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
