-- D-7: 証憑カラムの掃除（1/2）
-- JournalEntry.receiptUrl はコード上の参照が 0 件の死にカラム。
-- 証憑は S-1/S-8 で Receipt テーブル（savedName ベース）に一本化済みのため削除する。

ALTER TABLE "journal_entries" DROP COLUMN "receiptUrl";
