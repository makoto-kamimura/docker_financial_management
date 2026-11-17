// 明細分け（通販の注文）の CSV を、取り込みの形（請求ごとの商品）にそろえる。ブラウザで変換し、
// そろえた請求を POST /api/shop-orders/import に JSON で送る（重複の判定・科目の学習ルールはサーバー）。
//
// 今読めるのは Amazon の公式の注文履歴（アカウントサービスの「データのリクエスト」で届く Retail.OrderHistory）。
// 1 行が 1 商品（1 発送の中の 1 商品）で、見出しは英語（Order ID・Order Date・Ship Date・Product Name・
// Original Quantity（旧 Quantity）・Total Amount（旧 Total Owed）・Order Status・Currency など）。
// Amazon は発送ごとにカードへ請求するので、注文番号と発送日が同じ行を 1 つの請求にまとめる。
//   - 金額は Total Amount（商品の税込みの金額に送料を足し、割引を引いた、その行で払った額）
//   - 日付は Ship Date（請求日に近い）。日付と時刻は UTC なので、日本の日付に直す
//   - 取り消した注文・まだ発送されていない行（Ship Date が無い）は、まだ請求されていないので飛ばす
//   - 円以外の通貨の行は飛ばす
// 住所・氏名・配送・ギフトの列は読まない（送らない）。

import Papa from "papaparse";
import { normalizeHeader, parseStatementAmount } from "@/lib/shared/statement-formats";

/** 取り込みの形の請求（カード・銀行の明細 1 行に当たる支払い） */
export type ShopChargeInput = {
  /** 重複を防ぐ鍵（Amazon は 注文番号|発送日） */
  key: string;
  orderNo: string;
  /** 請求日（YYYY-MM-DD） */
  date: string;
  /** 請求額（商品の金額の合計） */
  amount: number;
  sellerName?: string | null;
  items: { name: string; quantity: number; amount: number }[];
};

export type ShopOrderConversion = {
  /** 読んだ形の名前（画面に出す） */
  format: string;
  charges: ShopChargeInput[];
  /** 飛ばした行（取り消し・未発送など）。理由ごとの件数 */
  skipped: { reason: string; count: number }[];
};

// Amazon の公式の注文履歴の列（normalizeHeader した形）。新旧どちらの名前でも読む
const AMAZON_COLUMNS = {
  orderId: ["orderid"],
  orderDate: ["orderdate"],
  shipDate: ["shipdate"],
  productName: ["productname"],
  quantity: ["originalquantity", "quantity"],
  total: ["totalamount", "totalowed"],
  currency: ["currency"],
  orderStatus: ["orderstatus"],
} as const;

type AmazonColumn = keyof typeof AMAZON_COLUMNS;

/** 見出しの行から Amazon の列の位置を決める。必要な列が無ければ null */
function amazonColumns(header: string[]): Record<AmazonColumn, number> | null {
  const keys = header.map(normalizeHeader);
  const found = {} as Record<AmazonColumn, number>;
  for (const [role, names] of Object.entries(AMAZON_COLUMNS) as [
    AmazonColumn,
    readonly string[],
  ][]) {
    found[role] = keys.findIndex((k) => names.includes(k));
  }
  const required: AmazonColumn[] = ["orderId", "orderDate", "productName", "total"];
  return required.every((r) => found[r] >= 0) ? found : null;
}

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * 日付を日本の YYYY-MM-DD にする。時刻つき（2026-11-03T14:20:00Z など）は UTC として日本の日付に直し、
 * 日付だけ（2026-11-03・2026/11/3）はそのまま。読めなければ null（"Not Available" など）
 */
export function amazonDate(raw: string | undefined): string | null {
  const s = (raw ?? "").trim();
  if (s === "") return null;
  const dateOnly = s.match(/^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/);
  if (dateOnly) {
    const [, y, m, d] = dateOnly;
    return `${y}-${m.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(s)) return null;
  // タイムゾーンの無い時刻は UTC とみなす（Amazon の書き出しは UTC）
  const t = Date.parse(/[zZ]|[+-]\d{2}:?\d{2}$/.test(s) ? s : `${s}Z`);
  if (Number.isNaN(t)) return null;
  return new Date(t + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Amazon の公式の注文履歴を読む。見出しが合わなければ null */
export function convertAmazonOrderHistory(text: string): ShopOrderConversion | null {
  const parsed = Papa.parse<string[]>(text.replace(/^﻿/, ""), { skipEmptyLines: true });
  const rows = parsed.data;
  if (rows.length === 0) return null;
  const col = amazonColumns(rows[0]);
  if (!col) return null;

  const skipped = new Map<string, number>();
  const skip = (reason: string) => skipped.set(reason, (skipped.get(reason) ?? 0) + 1);
  const cell = (r: string[], c: number) => (c >= 0 ? (r[c] ?? "").trim() : "");

  const charges = new Map<string, ShopChargeInput>();
  for (const r of rows.slice(1)) {
    const orderNo = cell(r, col.orderId);
    if (orderNo === "") {
      skip("注文番号の無い行");
      continue;
    }
    if (/cancel/i.test(cell(r, col.orderStatus))) {
      skip("取り消した注文");
      continue;
    }
    const currency = cell(r, col.currency);
    if (currency !== "" && currency.toUpperCase() !== "JPY") {
      skip("円以外の通貨");
      continue;
    }
    const shipDate = amazonDate(cell(r, col.shipDate));
    if (col.shipDate >= 0 && shipDate === null) {
      skip("まだ発送されていない商品（請求前）");
      continue;
    }
    const date = shipDate ?? amazonDate(cell(r, col.orderDate));
    const amount = parseStatementAmount(cell(r, col.total));
    if (date === null || amount === null) {
      skip("日付・金額の読めない行");
      continue;
    }
    const quantity = Math.max(1, Math.round(parseStatementAmount(cell(r, col.quantity)) ?? 1));
    const name = cell(r, col.productName) || "（商品名なし）";
    const key = `${orderNo}|${date}`;
    const charge =
      charges.get(key) ?? ({ key, orderNo, date, amount: 0, items: [] } as ShopChargeInput);
    charge.items.push({ name: name.slice(0, 500), quantity, amount });
    charge.amount += amount;
    charges.set(key, charge);
  }

  const list = [...charges.values()].filter((c) => {
    if (c.amount > 0) return true;
    skip("請求額が 0 円の発送（無料の商品など）");
    return false;
  });
  return {
    format: "Amazon の注文履歴（データのリクエスト）",
    charges: list
      .map((c) => ({ ...c, amount: Math.round(c.amount) }))
      .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1)),
    skipped: [...skipped].map(([reason, count]) => ({ reason, count })),
  };
}

/** JSON の値の葉（文字列・数値などの項目）の数。WAF は JSON の本文を項目ごとに数える */
export function countJsonFields(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((n: number, v) => n + countJsonFields(v), 0);
  if (value !== null && typeof value === "object") {
    return Object.values(value).reduce(
      (n: number, v) => n + (v === undefined ? 0 : countJsonFields(v)),
      0,
    );
  }
  return 1;
}

/**
 * 請求を、送る前の WAF に止められない大きさの組に分ける。WAF は本文の大きさ（128KB ほど）と、
 * JSON の項目の数（1,000 ほど）で止めるので、JSON にしたときの大きさが maxBytes 以下、項目の数が maxFields 以下に収める。
 * 1 件でどちらかを超える請求は、その 1 件だけの組にする
 */
export function chunkCharges(
  charges: ShopChargeInput[],
  maxBytes = 100_000,
  maxFields = 500,
): ShopChargeInput[][] {
  const encoder = new TextEncoder();
  const chunks: ShopChargeInput[][] = [];
  let current: ShopChargeInput[] = [];
  let size = 0;
  let fields = 0;
  for (const c of charges) {
    const bytes = encoder.encode(JSON.stringify(c)).length + 1;
    const n = countJsonFields(c);
    if (current.length > 0 && (size + bytes > maxBytes || fields + n > maxFields)) {
      chunks.push(current);
      current = [];
      size = 0;
      fields = 0;
    }
    current.push(c);
    size += bytes;
    fields += n;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}
