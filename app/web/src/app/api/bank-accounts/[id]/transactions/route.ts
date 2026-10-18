import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { badRequest, CSV_MOVED_MESSAGE, gone, notFound } from "@/lib/server/api-error";
import {
  BANK,
  CARD,
  createEntry,
  entryCategory,
  ENTRY_REFS_INCLUDE,
  toBankTxn,
} from "@/lib/ledger/ledger-entries";
import { assertActualsPeriodsEditable } from "@/lib/budget/budget-lock";
import { invalidateCache } from "@/lib/server/redis";
import { applyAutoOffset } from "@/lib/ledger/auto-offset";
import { BusinessInput, entryBusiness } from "@/lib/ledger/business-use";
import { invalidateActualsCaches } from "@/lib/server/closing-cache";

// 事業利用・按分は省略可（省略すると、学習ルールが科目を決めたときはルールの事業利用、それ以外は事業利用なし）
const TxnSchema = BusinessInput.extend({
  date: z.string().min(1),
  description: z.string().min(1),
  amount: z.number(),
  /** 科目。省略すると学習ルールで決め、null なら未割り当て（付けた明細はそのまま実績になる） */
  categoryAccountId: z.number().int().positive().nullable().optional(),
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

// POST /api/bank-accounts/[id]/transactions … 手動登録（JSON）。CSV は POST /api/imports
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, db, id, audit }) => {
    const account = await db.bankAccount.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!account) throw notFound("account not found");

    const ct = req.headers.get("content-type") ?? "";

    // 明細の CSV は実績管理の取り込み（POST /api/imports）から入れる
    if (!ct.includes("application/json")) throw gone(CSV_MOVED_MESSAGE);

    const parsed = TxnSchema.safeParse(await req.json());
    if (!parsed.success) throw badRequest("date, description, amount は必須です");

    const body = parsed.data;
    const category = await entryCategory(
      db,
      user.tenantId,
      body.categoryAccountId,
      body.description,
      body.amount,
    );
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
        category,
        business: await entryBusiness(db, body, category, account.businessUse),
      },
    );
    // 同じ日・同じ金額の対になる明細が 1 組だけあれば、振替・チャージの組にする
    await applyAutoOffset(db, [txn.date!]);
    const saved = await db.financialRecord.findUniqueOrThrow({
      where: { id: txn.id },
      include: ENTRY_REFS_INCLUDE,
    });

    await invalidateActualsCaches(user.tenantId);
    await audit("create_txn", `bank_account:${id}:${txn.id}`);
    await invalidateCache(`assets:summary:${user.tenantId}:*`);
    return NextResponse.json({ data: toBankTxn(saved) }, { status: 201 });
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
    await invalidateActualsCaches(user.tenantId);
    await audit("delete_txn", `bank_account:${id}:${query.txnId}`);
    await invalidateCache(`assets:summary:${user.tenantId}:*`);
    return NextResponse.json({ ok: true });
  },
});
