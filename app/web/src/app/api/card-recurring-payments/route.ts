import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { conflict, notFound } from "@/lib/api-error";
import { CardRecurringCreateSchema } from "@/lib/card-recurring-schema";

// カードの固定決済（毎月このカードで決済されるサブスク・通信費など）。
//
// 銀行の資金移動ルール（/api/transfers）のカード版だが、銀行口座を持たない点が異なる。
// 実際の出金はカード全体の引き落とし 1 本にまとまるため、資金繰り・残高予測には出さず、
// 「このカードで毎月いくら固定で決済されるか」の把握にだけ使う。

// GET /api/card-recurring-payments?accountId=1 … 固定決済の一覧（accountId 省略で全カード分）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ accountId: z.coerce.number().int().positive().optional() }),
  handler: async ({ user, db, query }) => {
    const items = await db.cardRecurringPayment.findMany({
      where: {
        tenantId: user.tenantId,
        ...(query.accountId ? { accountId: query.accountId } : {}),
      },
      include: {
        account: { select: { id: true, name: true, type: true } },
        categoryAccount: { select: { id: true, code: true, name: true } },
      },
      orderBy: [{ day: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({
      data: items.map((i) => ({ ...i, amount: Number(i.amount) })),
    });
  },
});

// POST /api/card-recurring-payments … 固定決済の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: CardRecurringCreateSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;

    const card = await db.linkedAccount.findUnique({
      where: { id: body.accountId, tenantId },
      select: { id: true },
    });
    if (!card) throw notFound("カードが見つかりません");

    // 同じカードに同じ摘要は登録させない（明細から登録するので取り違えやすい）。
    // DB の @@unique と二重の防御だが、こちらは理由の分かるメッセージを返すために置く。
    const duplicate = await db.cardRecurringPayment.findFirst({
      where: { accountId: body.accountId, label: body.label },
      select: { id: true },
    });
    if (duplicate) throw conflict("同じ摘要の固定決済が既に登録されています");

    const item = await db.cardRecurringPayment.create({
      data: {
        tenantId,
        accountId: body.accountId,
        label: body.label,
        amount: body.amount,
        day: body.day,
        categoryAccountId: body.categoryAccountId ?? null,
        note: body.note ?? null,
      },
    });
    await audit("create", `card_recurring_payment:${item.id}`);
    return NextResponse.json({ data: { ...item, amount: Number(item.amount) } }, { status: 201 });
  },
});
