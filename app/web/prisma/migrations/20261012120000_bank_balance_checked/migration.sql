-- 口座の差額を確かめて保存した日時。
--
-- 差額は既定で 0 なので、「まだ確かめていない」と「確かめて 0 円だった（明細合計どおり）」を見分けられず、
-- 0 円を保存しても「差額を入力」の案内が消えなかった。保存したら（0 円でも）この日時を入れ、案内を出さない。
-- 既存の口座で差額が 0 でないものは、すでに差額を入れている＝確かめ済みとみなし、登録日時を入れる。

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN "balanceCheckedAt" TIMESTAMP(3);

UPDATE "bank_accounts" SET "balanceCheckedAt" = "createdAt" WHERE "balanceAdjustment" <> 0;
