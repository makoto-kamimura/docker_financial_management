import { redirect } from "next/navigation";

// 入出金管理は「銀行管理」（/bank-accounts）のタブへ統合した。
// 既存のブックマーク・外部リンクを壊さないよう、統合先へ転送する。
export default function BankTransactionsPage() {
  redirect("/bank-accounts?tab=transactions");
}
