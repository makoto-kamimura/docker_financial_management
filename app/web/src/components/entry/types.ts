// 実績管理の部品で使う型と、現金の明細の小さな計算。

// ── 型定義 ─────────────────────────────────────────────────────────
export type Account = {
  id: number;
  code: string;
  name: string;
  category: string;
  parentId: number | null;
  parent: { id: number; code: string; name: string } | null;
  soleName?: string | null;
  corporateName?: string | null;
};

// 現金の明細（GET /api/actuals）。科目を付けた明細がそのまま実績になる
export type CashEntry = {
  id: number;
  date: string;
  description: string;
  /** +入金 / −出金 */
  amount: number;
  categoryAccountId: number | null;
  categoryAccount: {
    id: number;
    code: string;
    name: string;
    category: string;
    soleName?: string | null;
    corporateName?: string | null;
  } | null;
};

// 収入・支出の科目区分（現金の登録フォームと科目の選択肢で使う）
export const INCOME_CATS = ["REVENUE", "PROFIT"];
export const EXPENSE_CATS = ["EXPENSE", "COGS"];

export function entryAmount(e: CashEntry): { income: number; expense: number } {
  return { income: Math.max(e.amount, 0), expense: Math.max(-e.amount, 0) };
}

// カレンダー・履歴で見る出どころ。現金＝実績（現金での支出・収入）、銀行＝入出金の明細、
// カード・電子マネー＝利用・返金の明細（銀行管理・カード管理の一覧とカレンダーをここへまとめた）
export type Source = "manual" | "bank" | "card";
export type SourceAccount = { id: number; name: string };
