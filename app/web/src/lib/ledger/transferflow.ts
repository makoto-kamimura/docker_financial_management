// 資金移動ルール（transfers.channel）の種類と表示名。
// 銀行の「毎月の入出金」とカードの引き落としの一覧で使う。

export type TransferChannel =
  | "BANK_TRANSFER"
  | "AUTO_DEBIT"
  | "CARD_PAYMENT"
  | "INCOME"
  | "EXPENSE";

export const CHANNEL_LABELS: Record<TransferChannel, string> = {
  BANK_TRANSFER: "口座間振込",
  AUTO_DEBIT: "銀行引き落とし",
  CARD_PAYMENT: "カード引き落とし",
  INCOME: "入金",
  EXPENSE: "支出",
};
