-- 摘要キーワードから科目を自動分類するルール表。
-- schema.prisma の TxnCategoryRule はマイグレーション未作成のままだったため、
-- CSV 取込（upsertExternalTransactions）が P2021 で 500 になっていた。ここで追いつかせる。

-- CreateTable
CREATE TABLE "txn_category_rules" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "keyword" TEXT NOT NULL,
    "categoryAccountId" INTEGER NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "txn_category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "txn_category_rules_tenantId_idx" ON "txn_category_rules"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "txn_category_rules_tenantId_keyword_key" ON "txn_category_rules"("tenantId", "keyword");

-- AddForeignKey
ALTER TABLE "txn_category_rules" ADD CONSTRAINT "txn_category_rules_categoryAccountId_fkey" FOREIGN KEY ("categoryAccountId") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
