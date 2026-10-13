-- レシートの読み取りの記録。テナントごとの 1 日の回数の上限を数えるのに使う（失敗は数えない）

-- CreateEnum
CREATE TYPE "ReceiptScanStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- CreateTable
CREATE TABLE "receipt_scan_requests" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "engine" TEXT NOT NULL,
    "status" "ReceiptScanStatus" NOT NULL DEFAULT 'PENDING',
    "model" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receipt_scan_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "receipt_scan_requests_tenantId_createdAt_idx" ON "receipt_scan_requests"("tenantId", "createdAt");


ALTER TABLE "receipt_scan_requests" ADD CONSTRAINT "receipt_scan_requests_engine_check"
  CHECK ("engine" IN ('claude', 'tesseract'));
