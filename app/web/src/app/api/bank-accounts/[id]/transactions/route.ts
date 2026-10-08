import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { parseBankCsv } from "@/lib/banktxn-import";
import {
  BANK,
  CARD,
  createEntry,
  ENTRY_REFS_INCLUDE,
  insertExternalEntries,
  toBankTxn,
} from "@/lib/ledger-entries";
import { assertActualsPeriodsEditable } from "@/lib/budget-lock";
import { invalidateCache } from "@/lib/redis";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { MAX_CSV_BYTES, MAX_IMPORT_ROWS } from "@/lib/import";

const TxnSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1),
  amount: z.number(),
  balance: z.number().nullable().optional(),
});

// GET /api/bank-accounts/[id]/transactions … 入出金明細（直近 200 件）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const account = await db.bankAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!account) throw notFound();

    // チャージ（デビット・プリペイド・電子マネーへの資金移動）の明細はチャージ先を表示し、
    // 科目を付けず、実績に入れない
    const txns = await db.financialRecord.findMany({
      where: { ...BANK, bankAccountId: id },
      orderBy: { date: "desc" },
      take: 200,
      include: ENTRY_REFS_INCLUDE,
    });
    return NextResponse.json({ data: txns.map(toBankTxn) });
  },
});

// POST /api/bank-accounts/[id]/transactions … 手動登録（JSON）/ CSV 取込（text）
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, db, id, audit }) => {
    const account = await db.bankAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!account) throw notFound("account not found");

    const ct = req.headers.get("content-type") ?? "";

    if (ct.includes("application/json")) {
      const parsed = TxnSchema.safeParse(await req.json());
      if (!parsed.success) throw badRequest("date, description, amount は必須です");

      const body = parsed.data;
      const txn = await createEntry(
        db,
        user.tenantId,
        { kind: "BANK", accountId: id },
        {
          date: new Date(body.date),
          description: body.description,
          flow: body.amount,
          balance: body.balance ?? null,
          source: "MANUAL",
        },
      );
      await audit("create_txn", `bank_account:${id}:${txn.id}`);
      await invalidateCache(`assets:summary:${user.tenantId}:*`);
      return NextResponse.json({ data: toBankTxn(txn) }, { status: 201 });
    }

    // S-9: CSV 取込のみユーザー単位のレート制限を適用（10 回 / 10 分）
    const rate = await checkRateLimit(`rl:import:user:${user.id}`, 10, 600);
    if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

    // S-11: Content-Length で事前拒否（ボディを読む前にサイズ超過を検出する）
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_CSV_BYTES) {
      throw badRequest("ファイルサイズが上限（5MB）を超えています。分割して取込してください。");
    }

    const csv = await req.text();
    if (!csv.trim()) throw badRequest("empty body");

    const { rows, errors } = parseBankCsv(csv, id);
    if (rows.length + errors.length > MAX_IMPORT_ROWS) {
      throw badRequest(
        `行数が上限（${MAX_IMPORT_ROWS}行）を超えています。分割して取込してください。`,
      );
    }

    const { inserted, locked } = await insertExternalEntries(
      db,
      user.tenantId,
      { kind: "BANK", accountId: id },
      rows,
      "CSV",
    );
    // 同じ内容の明細は externalId の一意制約で自動的にスキップされる（重複取込の防止）。
    // 実績を確定済みの月の行は登録しない（locked）
    const skipped = rows.length - inserted - locked;
    await audit("import_txn", `bank_account:${id}:${inserted}`);
    await invalidateCache(`assets:summary:${user.tenantId}:*`);
    return NextResponse.json(
      { inserted, skipped, locked, errors },
      { status: errors.length ? 207 : 201 },
    );
  },
});

// DELETE /api/bank-accounts/[id]/transactions?txnId= … 明細 1 件の削除
export const DELETE = withApi({
  role: "editor",
  querySchema: z.object({ txnId: z.coerce.number().int().positive() }),
  handler: async ({ user, db, id, query, audit }) => {
    const account = await db.bankAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!account) throw notFound();

    // 口座間振替は 2 行で 1 件なので、片方を消したら対の行（相手口座側）も一緒に消す。
    // 片側だけ残すと相手口座の残高がずれるため。
    const target = await db.financialRecord.findFirst({
      where: { id: query.txnId, ...BANK, bankAccountId: id },
      select: { transferGroupId: true, chargeGroupId: true, periodId: true },
    });
    if (!target) throw notFound();
    // 実績を確定済みの月の明細は消せない（振替なら相手の行の月も見る）
    const pairPeriods = target.transferGroupId
      ? await db.financialRecord.findMany({
          where: { transferGroupId: target.transferGroupId, ...BANK },
          select: { periodId: true },
        })
      : [];
    await assertActualsPeriodsEditable(db, [
      target.periodId,
      ...pairPeriods.map((p) => p.periodId),
    ]);

    // チャージ先の明細と対にしていた場合、相手はチャージ先カードの明細で、この出金が消えても
    // それ自体は実在する記録なので消さない。紐付けだけ外して科目を付けられる状態に戻す。
    if (target.chargeGroupId) {
      await db.financialRecord.updateMany({
        where: { chargeGroupId: target.chargeGroupId, ...CARD },
        data: { chargeGroupId: null },
      });
    }

    if (target.transferGroupId) {
      await db.financialRecord.deleteMany({
        where: { transferGroupId: target.transferGroupId, ...BANK },
      });
    } else {
      await db.financialRecord.delete({ where: { id: query.txnId, bankAccountId: id } });
    }
    await audit("delete_txn", `bank_account:${id}:${query.txnId}`);
    await invalidateCache(`assets:summary:${user.tenantId}:*`);
    return NextResponse.json({ ok: true });
  },
});
