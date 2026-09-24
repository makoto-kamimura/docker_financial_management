-- カード引き落とし（CARD_PAYMENT）の資金移動ルールに、引き落とし対象の
-- 登録済みカード・電子マネー（linked_accounts）を紐付けられるようにする。
ALTER TABLE "transfers" ADD COLUMN "linkedAccountId" INTEGER;

CREATE INDEX "transfers_linkedAccountId_idx" ON "transfers"("linkedAccountId");

ALTER TABLE "transfers"
  ADD CONSTRAINT "transfers_linkedAccountId_fkey"
  FOREIGN KEY ("linkedAccountId") REFERENCES "linked_accounts"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
