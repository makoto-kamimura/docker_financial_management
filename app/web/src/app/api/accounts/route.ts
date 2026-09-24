import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { ACCOUNT_CATEGORIES } from "@/lib/account-category";
import { badRequest, conflict } from "@/lib/api-error";
import { findAccountByCode } from "@/lib/period";
import { nextAccountCode } from "@/lib/next-account-code";

const AccountSchema = z.object({
  // 省略時は同じ区分の既存コードから自動採番する（設定「科目名設定」の追加ボタン）
  code: z.string().min(1).optional(),
  name: z.string().min(1),
  category: z.enum(ACCOUNT_CATEGORIES).default("OTHER"),
  parentCode: z.string().optional(),
  soleName: z.string().max(255).optional(),
  corporateName: z.string().max(255).optional(),
});

// GET /api/accounts … 勘定科目一覧（要ログイン）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const accounts = await db.account.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { code: "asc" },
      include: {
        parent: { select: { id: true, code: true, name: true } },
      },
    });
    return NextResponse.json({ data: accounts });
  },
});

// POST /api/accounts … 勘定科目の登録（editor 以上）。code 省略時は自動採番。
export const POST = withApi({
  role: "editor",
  schema: AccountSchema,
  handler: async ({ user, db, body, audit }) => {
    const { parentCode, code, ...fields } = body;
    const { tenantId } = user;

    let parentId: number | undefined;
    if (parentCode) {
      const parent = await findAccountByCode(db, tenantId, parentCode);
      if (!parent) throw badRequest(`unknown parentCode: ${parentCode}`);
      parentId = parent.id;
    }

    let resolvedCode = code;
    if (resolvedCode) {
      const dup = await findAccountByCode(db, tenantId, resolvedCode);
      if (dup) throw conflict(`コード「${resolvedCode}」は既に使用されています`);
    } else {
      const existing = await db.account.findMany({
        where: { tenantId },
        select: { code: true, category: true },
      });
      resolvedCode = nextAccountCode(
        existing.filter((a) => a.category === fields.category).map((a) => a.code),
        fields.category,
        existing.map((a) => a.code),
      );
    }

    const account = await db.account.create({
      data: { tenantId, code: resolvedCode, ...fields, parentId },
    });
    await audit("create", `account:${account.id}`);
    return NextResponse.json({ data: account }, { status: 201 });
  },
});
