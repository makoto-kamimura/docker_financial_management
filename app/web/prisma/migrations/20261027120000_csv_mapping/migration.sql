-- 銀行口座・カード（電子マネー）ごとに覚える、明細の CSV の読み方（見出しの列と役割）。取り込みの画面で直したもの。

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "csvMapping" JSONB;

-- AlterTable
ALTER TABLE "linked_accounts" ADD COLUMN     "csvMapping" JSONB;
