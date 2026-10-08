// 実績管理の CSV インポート（銀行・カードの明細）。登録先の振り分け（純関数）。
//
// 登録先の列つき CSV: target,account,date,description,amount,balance
//   - target: 銀行 / bank、カード / card（電子マネーも可）。実績 / actual は誤りとして返す
//     （実績は明細に科目を付けると入る。科目×月へ直接入れる取り込みはやめた）
//   - 銀行: account（口座の名前）・date・description・amount（入金は正）・balance
//   - カード: account（カード・電子マネーの名前）・date・description・amount（明細そのまま。支出は負。
//     明細の表も +入金 / −出金なので、そのまま保存する: lib/ledger-entries.ts）
// 登録先の列が無い CSV は、画面で選んだ登録先と口座にそのまま入れる（今までの各画面の CSV と同じ書式）。
// 誤りが 1 行でもあれば、どの行も取り込まない。

import { parseBankRow, type ParsedTxn } from "@/lib/banktxn-import";

export type LedgerTarget = "actual" | "bank" | "card";
export type LedgerImportError = { row: number; message: string };
type NamedAccount = { id: number; name: string };

const TARGET_ALIASES: Record<string, LedgerTarget> = {
  実績: "actual",
  actual: "actual",
  銀行: "bank",
  bank: "bank",
  カード: "card",
  電子マネー: "card",
  card: "card",
};

/** target 列の値を登録先にする（大文字小文字・前後の空白は無視）。当てはまらなければ null */
export function parseTarget(value: unknown): LedgerTarget | null {
  const v = String(value ?? "").trim();
  return TARGET_ALIASES[v] ?? TARGET_ALIASES[v.toLowerCase()] ?? null;
}

/** 登録先の列つきの CSV か（ヘッダに target 列があるか） */
export function hasTargetColumn(fields: string[] | undefined): boolean {
  return (fields ?? []).some((f) => f.trim() === "target");
}

export type RoutedLedger = {
  /** 口座 id -> 銀行の明細 */
  bank: Map<number, ParsedTxn[]>;
  /** カード id -> カードの明細（符号は CSV のまま。明細の表にもそのまま入る） */
  card: Map<number, ParsedTxn[]>;
  errors: LedgerImportError[];
};

const str = (v: unknown) => String(v ?? "").trim();

/**
 * 登録先の列つきの行を振り分ける。row は CSV の行番号（ヘッダが 1 行目なので、データの 1 行目は 2）。
 * 口座・カードは名前で探す（前後の空白は無視、完全一致）。
 */
export function routeLedgerRows(
  rows: Record<string, unknown>[],
  ctx: { bankAccounts: NamedAccount[]; cards: NamedAccount[] },
): RoutedLedger {
  const out: RoutedLedger = { bank: new Map(), card: new Map(), errors: [] };
  const findByName = (list: NamedAccount[], name: string) =>
    list.find((a) => a.name.trim() === name);

  rows.forEach((raw, i) => {
    const row = i + 2;
    const target = parseTarget(raw.target);
    if (!target) {
      out.errors.push({
        row,
        message: `登録先（target）が分かりません: ${str(raw.target) || "空欄"}`,
      });
      return;
    }
    if (target === "actual") {
      // 実績は明細に科目を付けると入る。科目×月へ直接入れる行は受け付けない
      out.errors.push({
        row,
        message: "実績の行は取り込めません。明細（銀行・カード）として入れてください",
      });
      return;
    }
    const list = target === "bank" ? ctx.bankAccounts : ctx.cards;
    const account = findByName(list, str(raw.account));
    if (!account) {
      out.errors.push({
        row,
        message: `${target === "bank" ? "口座" : "カード・電子マネー"}（account）が見つかりません: ${str(raw.account) || "空欄"}`,
      });
      return;
    }
    const txn = parseBankRow(
      {
        date: str(raw.date),
        description: str(raw.description),
        amount: str(raw.amount),
        ...(str(raw.balance) ? { balance: str(raw.balance) } : {}),
      },
      account.id,
    );
    if (!txn) {
      out.errors.push({ row, message: "date・description・amount を確かめてください" });
      return;
    }
    const map = target === "bank" ? out.bank : out.card;
    map.set(account.id, [...(map.get(account.id) ?? []), txn]);
  });

  return out;
}
