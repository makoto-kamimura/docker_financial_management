// カード台帳（LinkedAccount）の種別。API と画面で同じ定義を使うためここに集約する。
//
// D-1 で銀行口座は BankAccount に分離したので、ここに並ぶのは「銀行口座そのものではない
// 決済手段」だけ。デビットカードは銀行口座直結で即時引き落とし、プリペイドカードと電子マネーは
// 事前チャージという違いはあるが、利用明細の構造はクレジットカードと同じなので同じ台帳で扱う。

export const LINKED_ACCOUNT_TYPES = [
  "CREDIT_CARD",
  "DEBIT_CARD",
  "PREPAID_CARD",
  "E_MONEY",
] as const;

export type LinkedAccountType = (typeof LINKED_ACCOUNT_TYPES)[number];

export const LINKED_ACCOUNT_TYPE_LABELS: Record<LinkedAccountType, string> = {
  CREDIT_CARD: "クレジットカード",
  DEBIT_CARD: "デビットカード",
  PREPAID_CARD: "プリペイドカード",
  E_MONEY: "電子マネー",
};

/** チャージ（事前入金）して使う種別。チャージ先として選べるのはこの 3 つ */
export const CHARGEABLE_TYPES: LinkedAccountType[] = ["DEBIT_CARD", "PREPAID_CARD", "E_MONEY"];

export function isChargeableType(type: string): boolean {
  return (CHARGEABLE_TYPES as string[]).includes(type);
}
