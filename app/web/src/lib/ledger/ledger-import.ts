// 実績管理の取り込み（銀行・カードの明細の CSV）。CSV の行を明細にする（純関数）。
//
// 列は 日付・摘要・金額・残高（英語の date・description・amount・balance も可）。銀行・カード会社・
// 電子マネーのサイトから落とした CSV は、画面（lib/shared/statement-formats.ts）でこの形にそろえてから送る。
//   - 金額は明細そのまま（入金は正、支出は負。カードの利用も負）。残高は銀行だけで、無くてもかまわない
// 取り込み先は画面で選んだ口座・カード 1 つ。科目の列は無い。取り込んだあと、学習ルールで科目を付ける
// （lib/ledger/ledger-entries.ts の insertExternalEntries）。誤りが 1 行でもあれば、どの行も取り込まない。

import { numberRepeatedIds, parseBankRow, type ParsedTxn } from "@/lib/ledger/banktxn-import";

export type LedgerImportError = { row: number; message: string };

// 日本語の列名を、明細の解釈（parseBankRow）が読む英語の列名にそろえる
const COLUMN_ALIASES: Record<string, string> = {
  日付: "date",
  date: "date",
  摘要: "description",
  description: "description",
  金額: "amount",
  amount: "amount",
  残高: "balance",
  balance: "balance",
};

/** 列名をそろえた行にする（知らない列はそのまま残す） */
export function normalizeRow(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(raw)) {
    const k = key.trim();
    out[COLUMN_ALIASES[k] ?? COLUMN_ALIASES[k.toLowerCase()] ?? k] = value;
  }
  return out;
}

const str = (v: unknown) => String(v ?? "").trim();

/** 明細 1 行を解釈する。形が違えば null */
export function parseLedgerRow(raw: Record<string, unknown>, accountId: number): ParsedTxn | null {
  const r = normalizeRow(raw);
  return parseBankRow(
    {
      date: str(r.date),
      description: str(r.description),
      amount: str(r.amount),
      ...(str(r.balance) ? { balance: str(r.balance) } : {}),
    },
    accountId,
  );
}

/**
 * CSV の行を明細にする。row は CSV の行番号（ヘッダが 1 行目なので、データの 1 行目は 2）。
 * 同じ明細の 2 回目以降は、番号を付けて別の明細にする（numberRepeatedIds）。
 */
export function parseLedgerRows(
  rows: Record<string, unknown>[],
  accountId: number,
): { rows: ParsedTxn[]; errors: LedgerImportError[] } {
  const parsed: ParsedTxn[] = [];
  const errors: LedgerImportError[] = [];
  rows.forEach((raw, i) => {
    const txn = parseLedgerRow(raw, accountId);
    if (txn) parsed.push(txn);
    else errors.push({ row: i + 2, message: "日付・摘要・金額を確かめてください" });
  });
  return { rows: numberRepeatedIds(parsed), errors };
}
