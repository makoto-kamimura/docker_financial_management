import { z } from "zod";

// 明細の CSV の 1 行スキーマ（実績管理の取り込み。lib/ledger/ledger-import.ts）。
// ヘッダ: date,description,amount[,balance]
// amount は +入金 / -出金
const RowSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  amount: z.coerce.number(),
  balance: z.coerce.number().optional(),
});

export type ParsedTxn = {
  date: string;
  description: string;
  amount: number;
  balance?: number;
  externalId: string;
};

/** CSV の 1 行（date,description,amount[,balance]）を明細にする。形が違えば null */
export function parseBankRow(raw: Record<string, unknown>, accountId: number): ParsedTxn | null {
  const r = RowSchema.safeParse(raw);
  if (!r.success) return null;
  const { date, description, amount, balance } = r.data;
  return {
    date,
    description,
    amount,
    balance,
    // externalId は内容から決定的に生成し重複取込を防ぐ
    externalId: `csv-${accountId}-${date}-${amount}-${description}`,
  };
}

/**
 * 1 つのファイルの中で同じ日付・金額・摘要の明細が 2 回目以降に出たら、externalId の末尾に #2, #3… を付ける。
 * 内容だけで決めた externalId は、同じ日に同じ店で同じ額を 2 回払うと同じになり、2 件目が重複として飛ぶため。
 * 1 回目は番号を付けない（それまでに取り込んだ明細と同じ id のままにする）。期間の重なる CSV を後から
 * 入れても、その日の明細がそろっていれば番号も同じになるので、二重には入らない。
 */
export function numberRepeatedIds<T extends { externalId: string }>(rows: T[]): T[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const n = (seen.get(r.externalId) ?? 0) + 1;
    seen.set(r.externalId, n);
    return n === 1 ? r : { ...r, externalId: `${r.externalId}#${n}` };
  });
}

// 学習ルールのキーワード正規化（前後空白除去・連続空白の圧縮・大文字化）。
// マッチング側（classifyByRules）も同じ大文字化で比較するため、保存形式を揃えておく。
export function normalizeKeyword(text: string): string {
  return text.trim().replace(/\s+/g, " ").toUpperCase();
}

/** 学習ルールを当てる明細の向き（ANY は入金・出金の両方） */
export type RuleFlowSide = "ANY" | "IN" | "OUT";

/** 明細の向き（明細の表の flow は銀行・カード・現金とも +入金 / −出金）。0 は向きなし */
export function ruleSideOf(flow: number): "IN" | "OUT" | null {
  const n = Math.round(flow);
  return n > 0 ? "IN" : n < 0 ? "OUT" : null;
}

export type TxnCategoryRuleInput = {
  keyword: string;
  categoryAccountId: number;
  priority: number;
  /** 省略は ANY */
  flowSide?: RuleFlowSide;
};

// 摘要にマッチするルールを決定する（取込時の自動分類。科目が付いた明細はそのまま実績になる）。
// side（明細の向き）を渡すと、その向きのルールと ANY のルールだけを見る。省略・null なら ANY のルールだけ。
// 優先度（priority）降順 → キーワード長い順 → 向きを決めたルールを ANY より先、で評価し、
// 最初に一致したもの（科目・事業利用）を採用する。
export function classifyByRules<R extends TxnCategoryRuleInput>(
  description: string,
  rules: R[],
  side?: "IN" | "OUT" | null,
): R | null {
  const normalizedDesc = normalizeKeyword(description);
  const sideOf = (r: R) => r.flowSide ?? "ANY";
  const sorted = rules
    .filter((r) => sideOf(r) === "ANY" || sideOf(r) === side)
    .sort((a, b) => {
      if (b.priority !== a.priority) return b.priority - a.priority;
      if (b.keyword.length !== a.keyword.length) return b.keyword.length - a.keyword.length;
      return Number(sideOf(b) !== "ANY") - Number(sideOf(a) !== "ANY");
    });
  for (const rule of sorted) {
    if (normalizedDesc.includes(normalizeKeyword(rule.keyword))) return rule;
  }
  return null;
}
