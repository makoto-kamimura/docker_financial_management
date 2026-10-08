// 実績管理の CSV インポート（現金・銀行・カードの明細）。取り込み先の振り分け（純関数）。
//
// 列は 取り込み先・日付・摘要・金額・残高（英語の account・date・description・amount・balance も可）。
//   - 取り込み先: 銀行口座の名前・カード（電子マネー）の名前・「現金」。この列がある CSV は、行ごとに振り分ける
//     （1 つのファイルで複数の口座・カードの明細をまとめて登録できる）。同じ名前の銀行とカードがあると決められないので誤り
//   - 金額は明細そのまま（入金は正、支出は負。カードの利用も負）。残高は銀行だけで、無くてもかまわない
// 取り込み先の列が無い CSV は、画面で選んだ取り込み先にそのまま入れる。
// 科目の列は無い。取り込んだあと、学習ルールで科目を付ける（lib/ledger/ledger-entries.ts の insertExternalEntries）。
// 誤りが 1 行でもあれば、どの行も取り込まない。

import { parseBankRow, type ParsedTxn } from "@/lib/ledger/banktxn-import";

export type LedgerImportError = { row: number; message: string };
type NamedAccount = { id: number; name: string };

/** 取り込み先 */
export type LedgerDestination =
  | { kind: "CASH" }
  | { kind: "BANK"; accountId: number }
  | { kind: "CARD"; accountId: number };

/** 現金の取り込み先の名前 */
export const CASH_DESTINATION = "現金";

// 日本語の列名を、明細の解釈（parseBankRow）が読む英語の列名にそろえる
const COLUMN_ALIASES: Record<string, string> = {
  取り込み先: "account",
  account: "account",
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

/** 取り込み先の列があるか（ヘッダに「取り込み先」か「account」があるか） */
export function hasDestinationColumn(fields: string[] | undefined): boolean {
  return (fields ?? []).some((f) => COLUMN_ALIASES[f.trim()] === "account");
}

const str = (v: unknown) => String(v ?? "").trim();

/**
 * 取り込み先の名前を、現金・銀行口座・カードのどれかに決める（前後の空白は無視、完全一致）。
 * 見つからない・銀行とカードの両方に同じ名前がある場合は、理由を返す。
 */
export function resolveDestination(
  name: string,
  ctx: { bankAccounts: NamedAccount[]; cards: NamedAccount[] },
): LedgerDestination | { error: string } {
  const n = name.trim();
  if (n === "") return { error: "取り込み先が空欄です" };
  if (n === CASH_DESTINATION) return { kind: "CASH" };
  const bank = ctx.bankAccounts.filter((a) => a.name.trim() === n);
  const card = ctx.cards.filter((a) => a.name.trim() === n);
  if (bank.length + card.length > 1) {
    return { error: `同じ名前の口座・カードが複数あるため、取り込み先を決められません: ${n}` };
  }
  if (bank.length === 1) return { kind: "BANK", accountId: bank[0].id };
  if (card.length === 1) return { kind: "CARD", accountId: card[0].id };
  return { error: `取り込み先（銀行口座・カード・現金）が見つかりません: ${n}` };
}

export const destinationKey = (d: LedgerDestination) =>
  d.kind === "CASH" ? "CASH" : `${d.kind}:${d.accountId}`;

export type RoutedLedger = {
  /** 取り込み先ごとの明細（金額は CSV のまま） */
  groups: { destination: LedgerDestination; rows: ParsedTxn[] }[];
  errors: LedgerImportError[];
};

/** 明細 1 行を解釈する。現金は口座が無いので externalId の口座の部分を 0 にする */
export function parseLedgerRow(
  raw: Record<string, unknown>,
  destination: LedgerDestination,
): ParsedTxn | null {
  const r = normalizeRow(raw);
  return parseBankRow(
    {
      date: str(r.date),
      description: str(r.description),
      amount: str(r.amount),
      ...(str(r.balance) ? { balance: str(r.balance) } : {}),
    },
    destination.kind === "CASH" ? 0 : destination.accountId,
  );
}

/**
 * 行を取り込み先ごとに振り分ける。row は CSV の行番号（ヘッダが 1 行目なので、データの 1 行目は 2）。
 * fixed を渡すと、取り込み先の列を見ずに、すべての行をそこへ入れる（列の無い CSV）。
 */
export function routeLedgerRows(
  rows: Record<string, unknown>[],
  ctx: { bankAccounts: NamedAccount[]; cards: NamedAccount[] },
  fixed?: LedgerDestination,
): RoutedLedger {
  const groups = new Map<string, { destination: LedgerDestination; rows: ParsedTxn[] }>();
  const errors: LedgerImportError[] = [];

  rows.forEach((raw, i) => {
    const row = i + 2;
    const resolved = fixed ?? resolveDestination(str(normalizeRow(raw).account), ctx);
    if ("error" in resolved) {
      errors.push({ row, message: resolved.error });
      return;
    }
    const txn = parseLedgerRow(raw, resolved);
    if (!txn) {
      errors.push({ row, message: "日付・摘要・金額を確かめてください" });
      return;
    }
    const key = destinationKey(resolved);
    const group = groups.get(key) ?? { destination: resolved, rows: [] };
    group.rows.push(txn);
    groups.set(key, group);
  });

  return { groups: [...groups.values()], errors };
}
