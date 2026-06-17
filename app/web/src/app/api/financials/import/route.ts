import { NextRequest, NextResponse } from "next/server";
import { importRows, parseCsv, parseXlsx } from "@/lib/import";

// POST /api/financials/import … CSV または Excel(xlsx) で実績を一括登録する。
// - Content-Type: text/csv → 本文を CSV として解釈
// - それ以外（xlsx 等のバイナリ） → 先頭シートを解釈
// ヘッダ列: accountCode, fiscalYear, month, amount
export async function POST(req: NextRequest) {
  const contentType = req.headers.get("content-type") ?? "";

  let rows: Record<string, unknown>[];
  if (contentType.includes("text/csv") || contentType.includes("text/plain")) {
    const csv = await req.text();
    if (!csv.trim()) return NextResponse.json({ error: "empty body" }, { status: 400 });
    rows = parseCsv(csv);
  } else {
    const buf = await req.arrayBuffer();
    if (buf.byteLength === 0) return NextResponse.json({ error: "empty body" }, { status: 400 });
    rows = parseXlsx(buf);
  }

  const result = await importRows(rows);
  return NextResponse.json(result, { status: result.errors.length ? 207 : 201 });
}
