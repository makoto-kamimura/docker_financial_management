import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// 全銀 API / オープンバンキング API 設定（環境変数から取得）
// OPENBANKING_API_KEY, OPENBANKING_API_BASE を .env で設定する
// 全銀 API: https://developer.zenginkyo.or.jp/
// 対応バンク: 三菱UFJ / みずほ / 三井住友 等（各行の API アカウントが必要）
const OPENBANKING_API_BASE = process.env.OPENBANKING_API_BASE ?? "https://api.openbanking.or.jp/v1";

// GET /api/integrations/openbanking?action=accounts
// 登録済み銀行口座一覧を返す。
//
// GET /api/integrations/openbanking?action=transactions&accountId=XXX&from=YYYY-MM-DD&to=YYYY-MM-DD
// 指定口座の入出金履歴を外部 API から取得して BankTransaction 形式で返す。
//
// POST /api/integrations/openbanking
// 取得した取引データを bank_transactions テーブルに同期保存する。
export async function GET(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const sp     = req.nextUrl.searchParams;
  const action = sp.get("action") ?? "accounts";
  const apiKey = process.env.OPENBANKING_API_KEY;

  if (action === "accounts") {
    const accounts = await prisma.bankAccount.findMany({
      orderBy: { bankName: "asc" },
    });
    return NextResponse.json({
      configured: !!apiKey,
      message:    apiKey ? undefined : "OPENBANKING_API_KEY が未設定です。環境変数を設定してください。",
      accounts:   accounts.map((a) => ({
        id:          a.id,
        bankName:    a.bankName,
        accountName: a.name,
        accountType: a.accountType,
      })),
    });
  }

  if (action === "transactions") {
    const accountId = sp.get("accountId");
    const from      = sp.get("from");
    const to        = sp.get("to");

    if (!accountId) {
      return NextResponse.json({ error: "accountId が必要です" }, { status: 400 });
    }

    if (!apiKey) {
      return NextResponse.json(
        { error: "OPENBANKING_API_KEY が設定されていません", configured: false },
        { status: 503 },
      );
    }

    const account = await prisma.bankAccount.findUnique({ where: { id: Number(accountId) } });
    if (!account) {
      return NextResponse.json({ error: "口座が見つかりません" }, { status: 404 });
    }

    const params = new URLSearchParams({ accountId });
    if (from) params.set("from", from);
    if (to)   params.set("to",   to);

    const txRes = await fetch(`${OPENBANKING_API_BASE}/transactions?${params}`, {
      headers: {
        "X-API-Key": apiKey,
        Accept:      "application/json",
      },
    });

    if (!txRes.ok) {
      return NextResponse.json({ error: "オープンバンキング API の呼び出しに失敗しました" }, { status: 502 });
    }

    const txData = await txRes.json() as { transactions: Array<{
      id: string; date: string; amount: number; description: string; balance: number | null;
    }> };

    return NextResponse.json({
      source:       "openbanking",
      accountId:    Number(accountId),
      count:        txData.transactions?.length ?? 0,
      transactions: txData.transactions,
    });
  }

  return NextResponse.json({ error: `unknown action: ${action}` }, { status: 400 });
}

// POST /api/integrations/openbanking
// 取引データを bank_transactions テーブルに同期保存する。
// body: { accountId: number; transactions: Array<{ date, amount, description, balance }> }
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const body = await req.json() as {
    accountId: number;
    transactions: Array<{ id: string; date: string; amount: number; description: string; balance: number | null }>;
  };

  if (!body.accountId || !Array.isArray(body.transactions)) {
    return NextResponse.json({ error: "accountId と transactions が必要です" }, { status: 400 });
  }

  const account = await prisma.bankAccount.findUnique({ where: { id: body.accountId } });
  if (!account) {
    return NextResponse.json({ error: "口座が見つかりません" }, { status: 404 });
  }

  let inserted = 0;
  let skipped  = 0;

  for (const tx of body.transactions) {
    const txDate = new Date(tx.date);
    const externalId = tx.id;
    const existing = await prisma.bankTransaction.findFirst({
      where: { accountId: account.id, externalId },
    });
    if (existing) { skipped++; continue; }

    await prisma.bankTransaction.create({
      data: {
        account:     { connect: { id: account.id } },
        date:        txDate,
        amount:      tx.amount,
        description: tx.description,
        balance:     tx.balance,
        source:      "SYNC",
        externalId,
      },
    });
    inserted++;
  }

  return NextResponse.json({ inserted, skipped }, { status: 201 });
}
