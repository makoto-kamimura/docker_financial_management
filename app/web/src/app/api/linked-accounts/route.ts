import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { requireAccountByCode } from "@/lib/period";
import { LINKED_ACCOUNT_TYPES } from "@/lib/linked-account-type";

// D-1: 銀行口座は /api/bank-accounts に一本化。本 API はクレジットカード・デビットカード・
// プリペイドカード・電子マネー（Suica・PayPay 等）の台帳を扱う。利用明細の構造はどれも同じ。
const LinkedAccountSchema = z.object({
  name: z.string().min(1),
  type: z.enum(LINKED_ACCOUNT_TYPES).default("CREDIT_CARD"),
  institution: z.string().min(1),
  lastFour: z.string().max(4).optional(),
  accountCode: z.string().optional(),
  note: z.string().optional(),
});

// GET /api/linked-accounts … クレジットカード・電子マネーの台帳一覧
//
// chargeSourceCount には「このカード・電子マネーをチャージ先に指定している明細」の件数を添える
// （カード明細の transferToAccountId と銀行明細の chargeToAccountId の合計）。台帳の種別を
// チャージ先に選べない クレジットカード へ戻すときに、既存の指定が取り残されることを
// 画面側で警告するために使う。
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const { tenantId } = user;
    const [items, charges] = await Promise.all([
      db.linkedAccount.findMany({
        where: { tenantId },
        orderBy: [{ institution: "asc" }],
        include: {
          account: { select: { id: true, code: true, name: true, category: true } },
        },
      }),
      db.ledgerEntry.groupBy({
        by: ["chargeToCardId"],
        where: { chargeToCardId: { not: null } },
        _count: { _all: true },
      }),
    ]);

    const chargeSources = new Map<number, number>();
    for (const g of charges) {
      const id = g.chargeToCardId;
      if (id !== null) chargeSources.set(id, (chargeSources.get(id) ?? 0) + g._count._all);
    }

    return NextResponse.json({
      data: items.map((a) => ({ ...a, chargeSourceCount: chargeSources.get(a.id) ?? 0 })),
    });
  },
});

// POST /api/linked-accounts … クレジットカード・電子マネーの登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: LinkedAccountSchema,
  handler: async ({ user, db, body, audit }) => {
    const { accountCode, ...fields } = body;
    const { tenantId } = user;

    let accountId: number | undefined;
    if (accountCode) {
      const acct = await requireAccountByCode(db, tenantId, accountCode);
      accountId = acct.id;
    }

    const item = await db.linkedAccount.create({ data: { tenantId, ...fields, accountId } });
    await audit("create", `linked_account:${item.id}`);
    return NextResponse.json({ data: item }, { status: 201 });
  },
});
