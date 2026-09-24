import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { parseBankCsv } from "@/lib/banktxn-import";
import { serializeCardTransaction, upsertExternalCardTransactions } from "@/lib/card-transactions";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { MAX_CSV_BYTES, MAX_IMPORT_ROWS } from "@/lib/import";

const TxnSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  amount: z.number(),
});

// GET /api/linked-accounts/[id]/transactions … カード利用明細（直近 200 件）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const account = await db.linkedAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!account) throw notFound();

    const txns = await db.cardTransaction.findMany({
      where: { accountId: id },
      orderBy: { date: "desc" },
      take: 200,
      include: {
        categoryAccount: { select: { id: true, code: true, name: true } },
        // チャージ（資金移動）の明細はチャージ先を表示し、科目紐付け・転記の対象外にする
        transferToAccount: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({ data: txns.map(serializeCardTransaction) });
  },
});

// POST /api/linked-accounts/[id]/transactions … 手動登録（JSON）/ CSV 取込（text）
// bank-accounts/[id]/transactions と同構造（ヘッダ: date,description,amount。銀行側と異なり balance 列はない）。
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, db, id, audit }) => {
    const account = await db.linkedAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!account) throw notFound("account not found");

    const ct = req.headers.get("content-type") ?? "";

    if (ct.includes("application/json")) {
      const parsed = TxnSchema.safeParse(await req.json());
      if (!parsed.success) throw badRequest("date, description, amount は必須です");

      const body = parsed.data;
      const txn = await db.cardTransaction.create({
        data: {
          accountId: id,
          date: new Date(body.date),
          description: body.description,
          amount: body.amount,
          source: "MANUAL",
        },
      });
      await audit("create_card_txn", `linked_account:${id}:${txn.id}`);
      return NextResponse.json({ data: serializeCardTransaction(txn) }, { status: 201 });
    }

    // S-9 と同様、CSV 取込のみユーザー単位のレート制限を適用（10 回 / 10 分）
    const rate = await checkRateLimit(`rl:import:user:${user.id}`, 10, 600);
    if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

    // S-11 と同様、Content-Length で事前拒否（ボディを読む前にサイズ超過を検出する）
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_CSV_BYTES) {
      throw badRequest("ファイルサイズが上限（5MB）を超えています。分割して取込してください。");
    }

    const csv = await req.text();
    if (!csv.trim()) throw badRequest("empty body");

    // parseBankCsv は date,description,amount[,balance] の汎用パーサ。
    // balance 列は無視され、カード明細としてそのまま利用できる。
    const { rows, errors } = parseBankCsv(csv, id);
    if (rows.length + errors.length > MAX_IMPORT_ROWS) {
      throw badRequest(
        `行数が上限（${MAX_IMPORT_ROWS}行）を超えています。分割して取込してください。`,
      );
    }

    const inserted = await upsertExternalCardTransactions(db, id, rows, "CSV");
    // 同じ内容の明細は externalId の一意制約で自動的にスキップされる（重複取込の防止）
    const skipped = rows.length - inserted;
    await audit("import_card_txn", `linked_account:${id}:${inserted}`);
    return NextResponse.json({ inserted, skipped, errors }, { status: errors.length ? 207 : 201 });
  },
});

// DELETE /api/linked-accounts/[id]/transactions?txnId= … 明細 1 件の削除
export const DELETE = withApi({
  role: "editor",
  querySchema: z.object({ txnId: z.coerce.number().int().positive() }),
  handler: async ({ user, db, id, query, audit }) => {
    const account = await db.linkedAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!account) throw notFound();

    // チャージとして対にしていた明細（チャージ元の銀行明細・カード明細）は実在する記録なので
    // 一緒には消さず、紐付けだけ外して科目紐付け・転記をできる状態に戻す
    const target = await db.cardTransaction.findFirst({
      where: { id: query.txnId, accountId: id },
      select: { chargeGroupId: true },
    });
    if (!target) throw notFound();

    if (target.chargeGroupId) {
      const where = { chargeGroupId: target.chargeGroupId };
      await Promise.all([
        db.cardTransaction.updateMany({
          where: { ...where, account: { tenantId: user.tenantId }, id: { not: query.txnId } },
          data: { chargeGroupId: null },
        }),
        db.bankTransaction.updateMany({
          where: { ...where, account: { tenantId: user.tenantId } },
          data: { chargeGroupId: null },
        }),
      ]);
    }

    await db.cardTransaction.delete({ where: { id: query.txnId, accountId: id } });
    await audit("delete_card_txn", `linked_account:${id}:${query.txnId}`);
    return NextResponse.json({ ok: true });
  },
});
