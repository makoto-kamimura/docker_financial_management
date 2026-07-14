-- CreateTable
CREATE TABLE "learning_progress" (
    "id" SERIAL NOT NULL,
    "tenantId" INTEGER NOT NULL,
    "userId" INTEGER NOT NULL,
    "topicKey" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_progress_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_progress_tenantId_idx" ON "learning_progress"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "learning_progress_userId_topicKey_key" ON "learning_progress"("userId", "topicKey");

-- AddForeignKey
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_progress" ADD CONSTRAINT "learning_progress_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

