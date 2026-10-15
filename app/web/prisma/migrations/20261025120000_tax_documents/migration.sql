-- 控除・確定申告で使う証明書の画像・PDF（tax_documents）と、証憑（レシート）のセルフメディケーション税制の対象の額・品目。

-- AlterTable
ALTER TABLE "receipts" ADD COLUMN     "selfMedicationAmount" DECIMAL(18,2),
ADD COLUMN     "selfMedicationItems" JSONB;

-- CreateTable
CREATE TABLE "tax_documents" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "taxYear" INTEGER NOT NULL,
    "docId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "savedName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "fileType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tax_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tax_documents_savedName_key" ON "tax_documents"("savedName");

-- CreateIndex
CREATE INDEX "tax_documents_tenantId_taxYear_idx" ON "tax_documents"("tenantId", "taxYear");
