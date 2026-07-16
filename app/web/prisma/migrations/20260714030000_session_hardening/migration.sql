-- AlterTable: セッションのハードニング（アイドルタイムアウト・監査用フィールド）
-- id は今後 SHA-256(token) を格納する（アプリ側で移行。既存の平文セッション行は
-- 自然失効まで残る）。lastSeenAt は既存行の起点として createdAt を初期値にする。
ALTER TABLE "sessions" ADD COLUMN     "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "ip" TEXT,
ADD COLUMN     "userAgent" TEXT;

UPDATE "sessions" SET "lastSeenAt" = "createdAt";

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");
