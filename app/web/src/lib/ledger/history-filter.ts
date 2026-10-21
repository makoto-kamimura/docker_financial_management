// 実績管理の「履歴」の明細の絞り込み（期間・摘要・金額）。GET /api/ledger/history で使う。
//
// - 期間: YYYY-MM-DD のローカル日付（明細の期間の解決と同じ）。to はその日の終わりまで含める
// - 摘要: 部分一致（大文字・小文字は区別しない）。CSV の摘要は全角英数字（「ＪＡＬ」）のことが多いので、
//   入力そのまま・NFKC（全角 → 半角）・英数字と記号を全角にしたものの 3 通りで探す。
//   半角カナ（「ｵｻｹ」）の明細を全角カナで探すことはできない
// - 金額: 入金・出金を問わず絶対値で比べる（flow は +入金 / −出金）

import type { Prisma } from "@prisma/client";

export type HistoryFilter = {
  dateFrom?: string;
  dateTo?: string;
  q?: string;
  amountMin?: number;
  amountMax?: number;
};

/** YYYY-MM-DD をローカル日付の 0 時にする */
const localDay = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, m - 1, d);
};

/** 英数字と記号（と空白）を全角にする */
const toFullWidth = (text: string) =>
  text.replace(/[!-~ ]/g, (c) =>
    c === " " ? "　" : String.fromCharCode(c.charCodeAt(0) + 0xfee0),
  );

/** 摘要を探す表記の候補（重複を除く） */
export function descriptionVariants(q: string): string[] {
  const t = q.trim();
  if (!t) return [];
  return [...new Set([t, t.normalize("NFKC"), toFullWidth(t.normalize("NFKC"))])];
}

/** 範囲が逆（from > to、min > max）なら、その理由。問題なければ null */
export function invalidHistoryFilter(f: HistoryFilter): string | null {
  if (f.dateFrom && f.dateTo && f.dateFrom > f.dateTo) return "期間の始まりが終わりより後です";
  if (f.amountMin !== undefined && f.amountMax !== undefined && f.amountMin > f.amountMax) {
    return "金額の下限が上限より大きいです";
  }
  return null;
}

/** 絞り込みの条件（AND でつなぐ）。指定の無いものは条件にしない */
export function historyFilterWhere(f: HistoryFilter): Prisma.FinancialRecordWhereInput[] {
  const and: Prisma.FinancialRecordWhereInput[] = [];
  if (f.dateFrom || f.dateTo) {
    const date: Prisma.DateTimeNullableFilter = {};
    if (f.dateFrom) date.gte = localDay(f.dateFrom);
    if (f.dateTo) {
      const end = localDay(f.dateTo);
      end.setDate(end.getDate() + 1);
      date.lt = end;
    }
    and.push({ date });
  }
  const variants = descriptionVariants(f.q ?? "");
  if (variants.length > 0) {
    and.push({
      OR: variants.map((v) => ({ description: { contains: v, mode: "insensitive" as const } })),
    });
  }
  const { amountMin: min, amountMax: max } = f;
  if (min !== undefined || max !== undefined) {
    // |flow| ∈ [min, max] を、入金側 [min, max] と出金側 [−max, −min] に開く
    const income: Prisma.DecimalNullableFilter = { gte: min ?? 0 };
    const expense: Prisma.DecimalNullableFilter = { lte: min ? -min : 0 };
    if (max !== undefined) {
      income.lte = max;
      expense.gte = -max;
    }
    and.push({ OR: [{ flow: income }, { flow: expense }] });
  }
  return and;
}
