// 実績管理の CSV インポート（実績・銀行・カードの統合）。登録先の振り分け（純関数）。
//
// 登録先の列つき CSV: target,account,date,description,amount,accountCode,fiscalYear,month,balance
//   - target: 実績 / actual、銀行 / bank、カード / card（電子マネーも可）
//   - 実績: accountCode・amount と、fiscalYear・month（無ければ date の年月）
//   - 銀行: account（口座の名前）・date・description・amount（入金は正）・balance
//   - カード: account（カード・電子マネーの名前）・date・description・amount（明細そのまま。支出は負。
//     保存時に符号を反転する: lib/card-transactions.ts）
// 登録先の列が無い CSV は、画面で選んだ登録先と口座にそのまま入れる（今までの各画面の CSV と同じ書式）。
// 誤りが 1 行でもあれば、どの行も取り込まない（実績の取込と同じ扱い）。

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
  /** 実績の行（lib/import.ts の importRows にそのまま渡せる形） */
  actual: Record<string, unknown>[];
  /** 口座 id -> 銀行の明細 */
  bank: Map<number, ParsedTxn[]>;
  /** カード id -> カードの明細（符号は CSV のまま。保存時に反転する） */
  card: Map<number, ParsedTxn[]>;
  errors: LedgerImportError[];
};

const str = (v: unknown) => String(v ?? "").trim();

/** 実績の行の年月。fiscalYear・month が無ければ date（YYYY-MM-DD / YYYY/MM/DD）の年月で補う */
function actualPeriod(raw: Record<string, unknown>): { fiscalYear: string; month: string } | null {
  if (str(raw.fiscalYear) && str(raw.month)) {
    return { fiscalYear: str(raw.fiscalYear), month: str(raw.month) };
  }
  const m = /^(\d{4})[-/](\d{1,2})/.exec(str(raw.date));
  return m ? { fiscalYear: m[1], month: String(Number(m[2])) } : null;
}

/**
 * 登録先の列つきの行を振り分ける。row は CSV の行番号（ヘッダが 1 行目なので、データの 1 行目は 2）。
 * 口座・カードは名前で探す（前後の空白は無視、完全一致）。
 */
export function routeLedgerRows(
  rows: Record<string, unknown>[],
  ctx: { bankAccounts: NamedAccount[]; cards: NamedAccount[] },
): RoutedLedger {
  const out: RoutedLedger = { actual: [], bank: new Map(), card: new Map(), errors: [] };
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
      const period = actualPeriod(raw);
      if (!str(raw.accountCode) || !period || str(raw.amount) === "") {
        out.errors.push({
          row,
          message:
            "実績の行には accountCode・amount と、年月（fiscalYear・month か date）が必要です",
        });
        return;
      }
      out.actual.push({ accountCode: str(raw.accountCode), amount: str(raw.amount), ...period });
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
