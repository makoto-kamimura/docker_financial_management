// 銀行・カード会社・電子マネーのサイトから落とした明細の CSV を、実績管理の CSV インポートの形
// （日付,摘要,金額,残高。金額は入金が正・支出が負）にそろえる。ブラウザで変換し、そろえた CSV を
// POST /api/imports にそのまま送る（取り込み・重複の判定はサーバーのまま）。
//
// 各社の CSV は、文字コード（Shift_JIS が多い）、見出しの前後の余計な行、列名、金額の向きがまちまち。
// 金融機関ごとの決め打ちはせず、見出しの列名から役割（日付・摘要・出金・入金・利用金額・符号つき金額・残高）を
// 決めて読む。見出しの無い CSV は、先頭から 日付・摘要・金額 の並びのカード明細として読む。

import Papa from "papaparse";

/** 変換したあとの明細 1 行（金額は入金が正・支出が負） */
export type StatementRow = { date: string; description: string; amount: number; balance?: number };

/** 金額の読み方 */
export type AmountStyle =
  /** 出金と入金が別の列（銀行・電子マネーに多い） */
  | "split"
  /** 利用金額の列（カード。利用が正なので向きを逆にする） */
  | "usage"
  /** 入金が正・出金が負の 1 列 */
  | "signed";

export type StatementConversion = {
  style: AmountStyle;
  /** 見出しが無く、列の並びで読んだ */
  headerless: boolean;
  /** 画面に出す、どの列をどう読んだか（例: 日付=取引日） */
  columns: { role: string; names: string[] }[];
  rows: StatementRow[];
  /** 日付や金額が読めず飛ばした行（合計・注記の行など）。text はその行の中身 */
  skipped: { text: string; reason: string }[];
};

// ── 文字コード ─────────────────────────────────────────────────────

/** UTF-8 として読めなければ Shift_JIS として読む（先頭の BOM は除く） */
export function decodeCsv(buf: ArrayBuffer | Uint8Array): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buf);
  } catch {
    text = new TextDecoder("shift_jis").decode(buf);
  }
  return text.replace(/^﻿/, "");
}

// ── 列名 ───────────────────────────────────────────────────────────

/** 列名を比べる形にする（全角を半角に、空白・引用符・単位の「(円)」を除き、小文字に） */
export function normalizeHeader(name: string): string {
  return name
    .normalize("NFKC")
    .replace(/["'\s]/g, "")
    .replace(/\((円|yen)\)$/i, "")
    .toLowerCase();
}

const names = (...list: string[]) => new Set(list.map(normalizeHeader));

const DATE_NAMES = names(
  "日付",
  "年月日",
  "取引日",
  "お取引日",
  "取引日付",
  "取扱日",
  "お取扱日",
  "入出金日",
  "利用日",
  "ご利用日",
  "利用年月日",
  "ご利用年月日",
  "date",
);
// 摘要は当たった列を、この順で最大 2 つつなぐ（例: 摘要 + 摘要内容、取引先 + 取引内容）
const DESCRIPTION_ORDER = [
  "摘要",
  "利用店名・商品名",
  "ご利用店名・商品名",
  "利用店名",
  "ご利用店名",
  "ご利用先",
  "利用先",
  "取引先",
  "お取り扱い内容",
  "お取扱内容",
  "お取引内容",
  "入出金内容",
  "取引内容",
  "内容",
  "摘要内容",
  "詳細1",
  "詳細2",
  "description",
].map(normalizeHeader);
const WITHDRAWAL_NAMES = names(
  "出金",
  "出金金額",
  "出金額",
  "お引出し",
  "お引出",
  "お引出し金額",
  "お引出金額",
  "支払い金額",
  "払出金額",
  "お支払い金額",
);
const DEPOSIT_NAMES = names(
  "入金",
  "入金金額",
  "入金額",
  "お預入れ",
  "お預入",
  "お預入れ金額",
  "お預入金額",
  "預かり金額",
  "お預かり金額",
  "お預り金額",
  "受入金額",
);
const USAGE_NAMES = names("利用金額", "ご利用金額", "利用額", "ご利用額", "支払総額");
const SIGNED_NAMES = names("金額", "入出金", "入出金額", "取引金額", "amount");
const BALANCE_NAMES = names(
  "残高",
  "差引残高",
  "現在残高",
  "取引後残高",
  "お取引後残高",
  "現在(貸付)高",
  "balance",
);

type Layout = {
  date: number;
  description: number[];
  withdrawal: number | null;
  deposit: number | null;
  usage: number | null;
  signed: number | null;
  balance: number | null;
};

/** 見出しの行から列の役割を決める。日付と金額の列が無ければ null */
function layoutOf(header: string[]): Layout | null {
  const norm = header.map(normalizeHeader);
  const find = (set: Set<string>) => {
    const i = norm.findIndex((h) => set.has(h));
    return i < 0 ? null : i;
  };
  const date = find(DATE_NAMES);
  if (date === null) return null;
  const description = DESCRIPTION_ORDER.map((n) => norm.indexOf(n))
    .filter((i) => i >= 0)
    .slice(0, 2);
  const layout: Layout = {
    date,
    description,
    withdrawal: find(WITHDRAWAL_NAMES),
    deposit: find(DEPOSIT_NAMES),
    usage: find(USAGE_NAMES),
    signed: find(SIGNED_NAMES),
    balance: find(BALANCE_NAMES),
  };
  const hasAmount =
    layout.withdrawal !== null ||
    layout.deposit !== null ||
    layout.usage !== null ||
    layout.signed !== null;
  return hasAmount ? layout : null;
}

function styleOf(l: Layout): AmountStyle {
  if (l.withdrawal !== null || l.deposit !== null) return "split";
  if (l.usage !== null) return "usage";
  return "signed";
}

// ── 値 ─────────────────────────────────────────────────────────────

// 和暦の元年（西暦 = 元年の西暦 + 年 - 1）
const ERAS: Record<string, number> = {
  r: 2019,
  令和: 2019,
  h: 1989,
  平成: 1989,
};

function ymd(y: number, m: number, d: number): string | null {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** 日付を YYYY-MM-DD にする（2026/10/1、2026年10月1日、20261001、R8.10.1、令和8年10月1日。時刻は捨てる）。読めなければ null */
export function parseStatementDate(raw: string): string | null {
  const s = raw.normalize("NFKC").trim().toLowerCase();
  let m = s.match(/^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})(?:\D|$)/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{4})(\d{2})(\d{2})(?:\D|$)/);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = s.match(/^(令和|平成|r|h)\s*(\d{1,2}|元)[年/.-](\d{1,2})[月/.-](\d{1,2})/);
  if (m) {
    const year = m[2] === "元" ? 1 : +m[2];
    return ymd(ERAS[m[1]] + year - 1, +m[3], +m[4]);
  }
  return null;
}

/** 金額を数にする（カンマ・円・¥・全角、△▲ の負号）。空欄・「-」は null */
export function parseStatementAmount(raw: string | undefined): number | null {
  if (raw === undefined) return null;
  let s = raw
    .normalize("NFKC")
    .replace(/[,\s円¥\\]/g, "")
    .trim();
  if (s === "" || s === "-") return null;
  let negative = false;
  if (/^[△▲-]/.test(s)) {
    negative = true;
    s = s.slice(1);
  }
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = Number(s);
  return negative ? -n : n;
}

// ── 変換 ───────────────────────────────────────────────────────────

const HEADER_SCAN_LINES = 30;

/** 見出しの無いカード明細か（先頭から 日付・摘要・金額 の並びの行が、データの大半を占める） */
function looksHeaderless(lines: string[][]): boolean {
  const data = lines.filter((l) => parseStatementDate(l[0] ?? "") !== null);
  if (data.length === 0 || data.length < lines.length / 2) return false;
  return data.every((l) => parseStatementAmount(l[2]) !== null);
}

/**
 * 明細の CSV をアプリの形にそろえる。見出しも、見出しの無いカード明細の並びも見つからなければ null。
 * 日付が読めない行・金額の無い行は、エラーにせず skipped に入れる（合計・注記の行があるため）。
 */
export function convertStatement(text: string): StatementConversion | null {
  const lines = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }).data;

  let headerIndex = -1;
  let layout: Layout | null = null;
  for (let i = 0; i < Math.min(lines.length, HEADER_SCAN_LINES); i++) {
    layout = layoutOf(lines[i]);
    if (layout) {
      headerIndex = i;
      break;
    }
  }

  let headerless = false;
  if (!layout) {
    if (!looksHeaderless(lines)) return null;
    headerless = true;
    layout = {
      date: 0,
      description: [1],
      withdrawal: null,
      deposit: null,
      usage: 2,
      signed: null,
      balance: null,
    };
  }

  const style = styleOf(layout);
  const rows: StatementRow[] = [];
  const skipped: StatementConversion["skipped"] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cells = lines[i];
    const text = cells.join(",");
    const date = parseStatementDate(cells[layout.date] ?? "");
    if (!date) {
      skipped.push({ text, reason: "日付が読めない行" });
      continue;
    }
    const amount = amountOf(cells, layout, style);
    if (amount === null) {
      skipped.push({ text, reason: "金額が無い行" });
      continue;
    }
    const description =
      [...new Set(layout.description.map((c) => (cells[c] ?? "").trim()).filter(Boolean))].join(
        " ",
      ) || "（摘要なし）";
    const balance = layout.balance === null ? null : parseStatementAmount(cells[layout.balance]);
    rows.push({ date, description, amount, ...(balance === null ? {} : { balance }) });
  }

  const header = headerless ? [] : lines[headerIndex];
  const col = (i: number | null) => (i === null ? [] : [header[i]?.trim() ?? `${i + 1} 列目`]);
  const columns = headerless
    ? [
        { role: "日付", names: ["1 列目"] },
        { role: "摘要", names: ["2 列目"] },
        { role: "利用金額", names: ["3 列目"] },
      ]
    : [
        { role: "日付", names: col(layout.date) },
        { role: "摘要", names: layout.description.flatMap(col) },
        ...(style === "split"
          ? [
              { role: "出金", names: col(layout.withdrawal) },
              { role: "入金", names: col(layout.deposit) },
            ]
          : style === "usage"
            ? [{ role: "利用金額", names: col(layout.usage) }]
            : [{ role: "金額", names: col(layout.signed) }]),
        { role: "残高", names: col(layout.balance) },
      ].filter((c) => c.names.length > 0);

  return { style, headerless, columns, rows, skipped };
}

function amountOf(cells: string[], l: Layout, style: AmountStyle): number | null {
  if (style === "split") {
    const out = l.withdrawal === null ? null : parseStatementAmount(cells[l.withdrawal]);
    const inn = l.deposit === null ? null : parseStatementAmount(cells[l.deposit]);
    if (out === null && inn === null) return null;
    const amount = (inn ?? 0) - (out ?? 0);
    return amount === 0 ? null : amount;
  }
  const v = parseStatementAmount(cells[style === "usage" ? l.usage! : l.signed!]);
  if (v === null || v === 0) return null;
  // カードの利用は正で書かれているので、支出（負）にする。返金（負）は入金（正）になる
  return style === "usage" ? -v : v;
}

/** そろえた明細を、実績管理の CSV インポートの形（日付,摘要,金額,残高）の CSV にする */
export function toImportCsv(rows: StatementRow[]): string {
  return Papa.unparse({
    fields: ["日付", "摘要", "金額", "残高"],
    data: rows.map((r) => [r.date, r.description, r.amount, r.balance ?? ""]),
  });
}

/** アプリの形の CSV か（日付・摘要・金額の列がそろっていて、出金・入金などの別の金額の列が無い） */
export function isImportFormat(header: string[]): boolean {
  const norm = new Set(header.map(normalizeHeader));
  const has = (...n: string[]) => n.some((x) => norm.has(normalizeHeader(x)));
  const other = [...WITHDRAWAL_NAMES, ...DEPOSIT_NAMES, ...USAGE_NAMES].some((n) => norm.has(n));
  return has("日付", "date") && has("摘要", "description") && has("金額", "amount") && !other;
}

/** 金額の読み方の説明（取り込み前の確認に出す） */
export const AMOUNT_STYLE_LABEL: Record<AmountStyle, string> = {
  split: "出金・入金が別の列の明細",
  usage: "利用金額の列の明細（カード。利用を支出として取り込みます）",
  signed: "入金が正・出金が負の金額の明細",
};
