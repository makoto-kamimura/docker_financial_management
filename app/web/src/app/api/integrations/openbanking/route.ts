import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { ApiError, badRequest, notFound } from "@/lib/api-error";

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
export const GET = withApi({
  role: "editor",
  querySchema: z.object({
    action: z.string().default("accounts"),
    accountId: z.coerce.number().int().positive().optional(),
    from: z.string().optional(),
    to: z.string().optional(),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const { action } = query;
    const apiKey = process.env.OPENBANKING_API_KEY;

    if (action === "accounts") {
      const accounts = await db.bankAccount.findMany({
        where: { tenantId },
        orderBy: { bankName: "asc" },
      });

      // 口座ごとの最新残高：最新トランザクションの balance or 取引合計
      const latestTxns = await db.bankTransaction.findMany({
        where: { accountId: { in: accounts.map((a) => a.id) } },
        orderBy: [{ date: "desc" }, { id: "desc" }],
        distinct: ["accountId"],
        select: { accountId: true, balance: true },
      });
      const balanceMap = new Map(
        latestTxns.map((t) => [t.accountId, t.balance != null ? Number(t.balance) : null]),
      );

      return NextResponse.json({
        configured: !!apiKey,
        message: apiKey
          ? undefined
          : "OPENBANKING_API_KEY が未設定です。環境変数を設定してください。",
        accounts: accounts.map((a) => ({
          id: a.id,
          bankName: a.bankName,
          accountName: a.name,
          accountType: a.accountType,
          balance: balanceMap.get(a.id) ?? null,
        })),
      });
    }

    if (action === "transactions") {
      const { accountId, from, to } = query;
      if (!accountId) throw badRequest("accountId が必要です");

      if (!apiKey) {
        return NextResponse.json(
          { error: "OPENBANKING_API_KEY が設定されていません", configured: false },
          { status: 503 },
        );
      }

      const account = await db.bankAccount.findUnique({ where: { id: accountId, tenantId } });
      if (!account) throw notFound("口座が見つかりません");

      const params = new URLSearchParams({ accountId: String(accountId) });
      if (from) params.set("from", from);
      if (to) params.set("to", to);

      const txRes = await fetch(`${OPENBANKING_API_BASE}/transactions?${params}`, {
        headers: {
          "X-API-Key": apiKey,
          Accept: "application/json",
        },
      });

      if (!txRes.ok) {
        throw new ApiError(502, "オープンバンキング API の呼び出しに失敗しました");
      }

      const txData = (await txRes.json()) as {
        transactions: Array<{
          id: string;
          date: string;
          amount: number;
          description: string;
          balance: number | null;
        }>;
      };

      return NextResponse.json({
        source: "openbanking",
        accountId,
        count: txData.transactions?.length ?? 0,
        transactions: txData.transactions,
      });
    }

    throw badRequest(`unknown action: ${action}`);
  },
});

const SyncSchema = z.object({
  accountId: z.number().int().positive(),
  transactions: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      amount: z.number(),
      description: z.string(),
      balance: z.number().nullable(),
    }),
  ),
});

// POST /api/integrations/openbanking … 取引データを bank_transactions テーブルに同期保存する。
export const POST = withApi({
  role: "editor",
  schema: SyncSchema,
  handler: async ({ user, db, body }) => {
    const account = await db.bankAccount.findUnique({
      where: { id: body.accountId, tenantId: user.tenantId },
    });
    if (!account) throw notFound("口座が見つかりません");

    let inserted = 0;
    let skipped = 0;

    for (const tx of body.transactions) {
      const existing = await db.bankTransaction.findFirst({
        where: { accountId: account.id, externalId: tx.id },
      });
      if (existing) {
        skipped++;
        continue;
      }

      await db.bankTransaction.create({
        data: {
          account: { connect: { id: account.id } },
          date: new Date(tx.date),
          amount: tx.amount,
          description: tx.description,
          balance: tx.balance,
          source: "SYNC",
          externalId: tx.id,
        },
      });
      inserted++;
    }

    return NextResponse.json({ inserted, skipped }, { status: 201 });
  },
});
