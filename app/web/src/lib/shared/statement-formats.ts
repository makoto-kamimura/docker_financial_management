// 銀行・カード会社・電子マネーのサイトから落とした明細の CSV を、実績管理の取り込みの形
// （日付,摘要,金額,残高。金額は入金が正・支出が負）にそろえる。ブラウザで変換し、そろえた CSV を
// POST /api/imports にそのまま送る（取り込み・重複の判定はサーバーのまま）。取り込む CSV はすべてここを通す
// （アプリの形の CSV も、符号つきの金額の明細として読む）。
//
// 各社の CSV は、文字コード（Shift_JIS が多い）、見出しの前後の余計な行、列名、金額の向きがまちまち。
// 金融機関ごとの決め打ちはせず、見出しの列名から役割（日付・摘要・出金・入金・利用金額・符号つき金額・
// 入金か出金かの区分・残高・取引の状態・通貨）を決めて読む。見出しの無い CSV は、先頭から 日付・摘要・金額 の
// 並びのカード明細として読む（三井住友カードの Vpass など。1 行目は氏名とカードの行）。

import Papa from "papaparse";
import { z } from "zod";

/** 変換したあとの明細 1 行（金額は入金が正・支出が負） */
export type StatementRow = { date: string; description: string; amount: number; balance?: number };

/** 金額の読み方 */
export type AmountStyle =
  /** 出金と入金が別の列（銀行・電子マネーに多い） */
  | "split"
  /** 利用金額の列（カード。利用が正なので向きを逆にする） */
  | "usage"
  /** 入金が正・出金が負の 1 列 */
  | "signed"
  /** 符号の無い金額の列と、入金か出金かの区分の列（区分など）。負の金額が 1 行でもあれば signed として読む */
  | "typed";

export type StatementConversion = {
  style: AmountStyle;
  /** 見出しが無く、列の並びで読んだ */
  headerless: boolean;
  /** 画面に出す、どの列をどう読んだか（例: 日付=取引日） */
  columns: { role: string; names: string[] }[];
  rows: StatementRow[];
  /** 日付や金額が読めず飛ばした行（合計・注記の行など）。text はその行の中身 */
  skipped: { text: string; reason: string }[];
  /** 読んだ見出しの行と列の役割（読み方を直す画面の初めの値）。見出しの無い明細は null */
  mapping: StatementMapping | null;
  /** 渡した読み方（options.mapping）で読んだ */
  mapped: boolean;
};

// ── 読み方（取り込みの画面で手で直し、口座・カードごとに覚えるもの）─────────────

const column = z.number().int().min(0).max(99).nullable();

/**
 * 明細の CSV の読み方。header は見出しの行（normalizeHeader した列名）で、同じ見出しの行がある CSV にだけ使う。
 * ほかは見出しの行での列の位置（0 始まり。null はその役割の列が無い）
 */
export const StatementMappingSchema = z
  .object({
    header: z.array(z.string().max(100)).min(1).max(100),
    date: z.number().int().min(0).max(99),
    description: z.array(z.number().int().min(0).max(99)).max(2),
    withdrawal: column,
    deposit: column,
    usage: column,
    signed: column,
    kind: column,
    balance: column,
  })
  .refine(
    (m) => m.withdrawal !== null || m.deposit !== null || m.usage !== null || m.signed !== null,
    "金額の列を選んでください",
  )
  .refine(
    (m) =>
      [m.date, ...m.description, m.withdrawal, m.deposit, m.usage, m.signed, m.kind, m.balance]
        .filter((i): i is number => i !== null)
        .every((i) => i < m.header.length),
    "見出しに無い列を選んでいます",
  );
export type StatementMapping = z.infer<typeof StatementMappingSchema>;

/** 見出しの行を比べる形（列名を正規化し、末尾の空の列を除く）。読み方の header はこの形 */
export function headerKey(cells: string[]): string[] {
  const norm = cells.map(normalizeHeader);
  while (norm.length > 0 && norm[norm.length - 1] === "") norm.pop();
  return norm;
}

const sameHeader = (a: string[], b: string[]) =>
  a.length === b.length && a.every((v, i) => v === b[i]);

/** 読み方を直す画面で選べる見出しの行（先頭 30 行のうち、値のある列が 2 つ以上の行） */
export function headerCandidates(text: string): { index: number; cells: string[] }[] {
  const lines = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }).data;
  return lines
    .slice(0, HEADER_SCAN_LINES)
    .map((cells, index) => ({ index, cells }))
    .filter(({ cells }) => cells.filter((c) => c.trim() !== "").length >= 2);
}

/** 見出しの行と列の役割から読み方を作る（読み方を直す画面で使う） */
export function mappingFor(
  headerCells: string[],
  roles: Omit<StatementMapping, "header">,
): StatementMapping {
  return { header: headerKey(headerCells), ...roles };
}

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
  "取引日時",
  "取扱日",
  "お取扱日",
  "取扱日付",
  "入出金日",
  "入出金日時",
  "利用日",
  "ご利用日",
  "利用日時",
  "ご利用日時",
  "利用年月日",
  "ご利用年月日",
  "日時",
  "date",
);
// 摘要は当たった列を、この順で最大 2 つつなぐ（例: 摘要 + 摘要内容、取引先 + 取引内容、内容 + 取引種別）
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
  "取引種別",
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
  "お引き出し",
  "お引出し金額",
  "お引出金額",
  "お引き出し金額",
  "引出金額",
  "支払い金額",
  "払出金額",
  "お支払い金額",
  "お支払金額",
);
const DEPOSIT_NAMES = names(
  "入金",
  "入金金額",
  "入金額",
  "お預入れ",
  "お預入",
  "お預け入れ",
  "お預入れ金額",
  "お預入金額",
  "お預け入れ金額",
  "預入金額",
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
// 入金か出金かの区分（符号の無い金額の向きを決める）。カードの「支払区分」（1 回払い・分割）は向きではないので入れない
const KIND_NAMES = names("区分", "入出金区分", "取引区分", "取引種別", "種別", "入出金種別");
// 取引の状態（取り消し・失敗の行を飛ばす）
const STATUS_NAMES = names("取引状態", "状態", "ステータス", "処理状況");
// 通貨（金額が 1 列のとき、円以外の行を飛ばす）
const CURRENCY_NAMES = names("通貨", "通貨コード");

type Layout = {
  date: number;
  description: number[];
  withdrawal: number | null;
  deposit: number | null;
  usage: number | null;
  signed: number | null;
  kind: number | null;
  balance: number | null;
  status: number | null;
  currency: number | null;
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
    kind: find(KIND_NAMES),
    balance: find(BALANCE_NAMES),
    status: find(STATUS_NAMES),
    currency: find(CURRENCY_NAMES),
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
  return l.kind !== null ? "typed" : "signed";
}

// 区分の値の言葉。入金と出金の両方に当たる値・取り消しの値は、向きを決めない
const IN_WORDS = [
  "入金",
  "預入",
  "預け入",
  "受入",
  "チャージ",
  "返金",
  "払戻",
  "払い戻",
  "受取",
  "受け取",
  "キャッシュバック",
  "還元",
  "利息",
  "給与",
  "賞与",
];
const OUT_WORDS = [
  "出金",
  "引出",
  "引き出",
  "払出",
  "支払",
  "利用",
  "ショッピング",
  "購入",
  "送金",
  "引落",
  "引き落",
  "手数料",
];

/** 区分の値から向きを決める（入金は 1、出金は -1）。決められなければ null */
export function directionOf(raw: string | undefined): 1 | -1 | null {
  const s = (raw ?? "").normalize("NFKC").trim();
  // 「入出金」は向きを表さない総称
  if (s === "" || /取消|取り消|キャンセル|入出/.test(s)) return null;
  const isIn = IN_WORDS.some((w) => s.includes(w));
  const isOut = OUT_WORDS.some((w) => s.includes(w));
  if (isIn === isOut) return null;
  return isIn ? 1 : -1;
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

const dateKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/**
 * 日付を YYYY-MM-DD にする（2026/10/1、2026年10月1日、20261001、26/10/01、R8.10.1、令和8年10月1日。時刻は捨てる）。
 * 年の無い日付（10/1、10月1日）は、ref（明細を落とした日など）の日以前でいちばん近い年にする。ref が無ければ読まない。
 * 読めなければ null
 */
export function parseStatementDate(raw: string, ref?: Date): string | null {
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
  // 2 桁の年は 2000 年代
  m = s.match(/^(\d{2})[/.-](\d{1,2})[/.-](\d{1,2})(?:\D|$)/);
  if (m) return ymd(2000 + +m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})(?:[/.-]|月)(\d{1,2})日?(?:\D|$)/);
  if (m && ref) {
    const thisYear = ymd(ref.getFullYear(), +m[1], +m[2]);
    if (thisYear === null) return ymd(ref.getFullYear() - 1, +m[1], +m[2]);
    return thisYear <= dateKey(ref) ? thisYear : ymd(ref.getFullYear() - 1, +m[1], +m[2]);
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

/**
 * 見出しの無いカード明細か。日付で始まる行がすべて 日付・摘要・金額 の並びで、ほかの行（1 行目の氏名・カードの行と、
 * 先頭が空欄の合計の行を除く）より多い。利用が 1 件だけの月でも読めるように、氏名と合計の行は数えない
 */
function looksHeaderless(lines: string[][]): boolean {
  const isData = (l: string[]) => parseStatementDate(l[0] ?? "") !== null;
  const data = lines.filter(isData);
  if (data.length === 0 || !data.every((l) => parseStatementAmount(l[2]) !== null)) return false;
  const others = lines.filter((l, i) => i > 0 && !isData(l) && (l[0] ?? "").trim() !== "");
  return data.length >= others.length;
}

/** 見出しの前の行（明細を落とした日時・照会期間など）にある日付のうち、いちばん遅い日 */
function latestDateIn(lines: string[][]): Date | null {
  let latest: string | null = null;
  for (const cell of lines.flat()) {
    const d = parseStatementDate(cell);
    if (d && (latest === null || d > latest)) latest = d;
  }
  if (latest === null) return null;
  const [y, m, d] = latest.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/**
 * 明細の CSV をアプリの形にそろえる。見出しも、見出しの無いカード明細の並びも見つからなければ null。
 * 日付が読めない行・金額の無い行・取り消しの行などは、エラーにせず skipped に入れる（合計・注記の行があるため）。
 * 年の無い日付は、見出しの前の行にある日付（明細を落とした日時など）、無ければ today を基準に年を決める。
 */
export function convertStatement(
  text: string,
  options: { today?: Date; mapping?: StatementMapping | null } = {},
): StatementConversion | null {
  const lines = Papa.parse<string[]>(text, { skipEmptyLines: "greedy" }).data;

  let headerIndex = -1;
  let layout: Layout | null = null;
  // 渡した読み方は、同じ見出しの行があるときだけ使う（無ければ自動で読む）
  const mapping = options.mapping ?? null;
  if (mapping) {
    for (let i = 0; i < Math.min(lines.length, HEADER_SCAN_LINES); i++) {
      if (sameHeader(headerKey(lines[i]), mapping.header)) {
        headerIndex = i;
        layout = layoutFromMapping(mapping, lines[i]);
        break;
      }
    }
  }
  const mapped = layout !== null;
  for (let i = 0; !layout && i < Math.min(lines.length, HEADER_SCAN_LINES); i++) {
    layout = layoutOf(lines[i]);
    if (layout) headerIndex = i;
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
      kind: null,
      balance: null,
      status: null,
      currency: null,
    };
  }

  const ref = latestDateIn(lines.slice(0, Math.max(headerIndex, 0))) ?? options.today ?? new Date();
  const header = headerless ? [] : lines[headerIndex];
  // 区分の列があっても、負の金額が 1 行でもある明細は符号のとおりに読む（JAL Pay はチャージが正・支払いが負で、
  // 取引種別には「非接触」「両替」など向きを表さない言葉も入る）
  let style = styleOf(layout);
  if (style === "typed") {
    const signedColumn = layout.signed!;
    const hasNegative = lines
      .slice(headerIndex + 1)
      .some((cells) => (parseStatementAmount(cells[signedColumn]) ?? 0) < 0);
    if (hasNegative) style = "signed";
  }
  const rows: StatementRow[] = [];
  const skipped: StatementConversion["skipped"] = [];
  for (let i = headerIndex + 1; i < lines.length; i++) {
    const cells = lines[i];
    const text = cells.join(",");
    const skip = (reason: string) => skipped.push({ text, reason });
    const date = parseStatementDate(cells[layout.date] ?? "", ref);
    if (!date) {
      skip("日付が読めない行");
      continue;
    }
    // 見出しより後ろの列に値がある行は、金額のカンマで列がずれているおそれがあるので読まない
    if (!headerless && cells.slice(header.length).some((c) => c.trim() !== "")) {
      skip("見出しより列が多い行（金額のカンマで列がずれているかもしれません）");
      continue;
    }
    if (layout.status !== null && isCancelled(cells[layout.status])) {
      skip("取り消し・失敗の行");
      continue;
    }
    if (
      (style === "signed" || style === "typed") &&
      layout.currency !== null &&
      isForeignCurrency(cells[layout.currency])
    ) {
      skip("円以外の通貨の行");
      continue;
    }
    const amount = amountOf(cells, layout, style);
    if (typeof amount === "string") {
      skip(amount);
      continue;
    }
    const description =
      [...new Set(layout.description.map((c) => (cells[c] ?? "").trim()).filter(Boolean))].join(
        " ",
      ) || "（摘要なし）";
    const balance = layout.balance === null ? null : parseStatementAmount(cells[layout.balance]);
    rows.push({ date, description, amount, ...(balance === null ? {} : { balance }) });
  }

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
            : style === "typed"
              ? [
                  { role: "金額", names: col(layout.signed) },
                  { role: "区分", names: col(layout.kind) },
                ]
              : [{ role: "金額", names: col(layout.signed) }]),
        { role: "残高", names: col(layout.balance) },
        { role: "状態", names: col(layout.status) },
        ...(style === "signed" || style === "typed"
          ? [{ role: "通貨", names: col(layout.currency) }]
          : []),
      ].filter((c) => c.names.length > 0);

  return {
    style,
    headerless,
    columns,
    rows,
    skipped,
    mapping: headerless ? null : mappingOf(layout, header),
    mapped,
  };
}

/** 読み方から列の役割を作る（取引の状態・通貨の列は、見出しの列名から決める） */
function layoutFromMapping(m: StatementMapping, header: string[]): Layout {
  const auto = layoutOf(header);
  const norm = header.map(normalizeHeader);
  const find = (set: Set<string>) => {
    const i = norm.findIndex((h) => set.has(h));
    return i < 0 ? null : i;
  };
  return {
    date: m.date,
    description: m.description,
    withdrawal: m.withdrawal,
    deposit: m.deposit,
    usage: m.usage,
    signed: m.signed,
    kind: m.kind,
    balance: m.balance,
    status: auto?.status ?? find(STATUS_NAMES),
    currency: auto?.currency ?? find(CURRENCY_NAMES),
  };
}

/** 列の役割から読み方を作る */
function mappingOf(l: Layout, header: string[]): StatementMapping {
  return mappingFor(header, {
    date: l.date,
    description: l.description,
    withdrawal: l.withdrawal,
    deposit: l.deposit,
    usage: l.usage,
    signed: l.signed,
    kind: l.kind,
    balance: l.balance,
  });
}

/** 取り消し・失敗の状態か */
function isCancelled(raw: string | undefined): boolean {
  return /取消|取り消|キャンセル|失敗|エラー|拒否|無効/.test((raw ?? "").normalize("NFKC"));
}

/** 円以外の通貨か（JPY・円・空欄・「-」は円とみなす） */
function isForeignCurrency(raw: string | undefined): boolean {
  const s = (raw ?? "").normalize("NFKC").trim().toUpperCase();
  const code = s.match(/^[A-Z]{3}/)?.[0];
  return code !== undefined && code !== "JPY";
}

/** 行の金額（入金が正・支出が負）。読めなければ飛ばす理由を返す */
function amountOf(cells: string[], l: Layout, style: AmountStyle): number | string {
  const NO_AMOUNT = "金額が無い行";
  if (style === "split") {
    const out = l.withdrawal === null ? null : parseStatementAmount(cells[l.withdrawal]);
    const inn = l.deposit === null ? null : parseStatementAmount(cells[l.deposit]);
    if (out === null && inn === null) return NO_AMOUNT;
    const amount = (inn ?? 0) - (out ?? 0);
    return amount === 0 ? NO_AMOUNT : amount;
  }
  const v = parseStatementAmount(cells[style === "usage" ? l.usage! : l.signed!]);
  if (v === null || v === 0) return NO_AMOUNT;
  // カードの利用は正で書かれているので、支出（負）にする。返金（負）は入金（正）になる
  if (style === "usage") return -v;
  if (style === "signed") return v;
  // 符号の無い明細なので、区分で向きを決める
  const direction = directionOf(cells[l.kind!]);
  if (direction !== null) return direction * v;
  return `入金か出金か分からない行（${(cells[l.kind!] ?? "").trim() || "区分が空欄"}）`;
}

/** そろえた明細を、実績管理の取り込みの形（日付,摘要,金額,残高）の CSV にする */
export function toImportCsv(rows: StatementRow[]): string {
  return Papa.unparse({
    fields: ["日付", "摘要", "金額", "残高"],
    data: rows.map((r) => [r.date, r.description, r.amount, r.balance ?? ""]),
  });
}

/** 金額の読み方の説明（取り込み前の確認に出す） */
export const AMOUNT_STYLE_LABEL: Record<AmountStyle, string> = {
  split: "出金・入金が別の列の明細",
  usage: "利用金額の列の明細（カード。利用を支出として取り込みます）",
  signed: "入金が正・出金が負の金額の明細",
  typed: "金額と、入金か出金かの区分が別の列の明細",
};
