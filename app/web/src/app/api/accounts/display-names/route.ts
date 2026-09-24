import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { conflict, forbidden } from "@/lib/api-error";
import { ACCOUNT_CATEGORIES } from "@/lib/account-category";

// 各科目の名称（家庭科目名 / 個人事業主モード / 法人モード）と区分を一括更新する。
// soleName / corporateName の空文字は null（＝家庭科目名 name にフォールバック）として保存する。
// name（家庭科目名）は必須項目のため空文字は受け付けない。
const BulkSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
        code: z.string().min(1).max(20).optional(),
        name: z.string().min(1).max(255).optional(),
        category: z.enum(ACCOUNT_CATEGORIES).optional(),
        soleName: z.string().max(255).nullable().optional(),
        corporateName: z.string().max(255).nullable().optional(),
      }),
    )
    .min(1),
});

const norm = (v: string | null | undefined): string | null => {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t === "" ? null : t;
};

// PUT /api/accounts/display-names … 科目名（家庭・個人・法人）と区分の一括更新（editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: BulkSchema,
  handler: async ({ user, db, body, audit }) => {
    const { tenantId } = user;
    const ids = body.items.map((i) => i.id);

    // 対象科目がすべて自テナントに属することを確認（他テナントの科目名は変更不可）
    const owned = await db.account.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true },
    });
    const ownedIds = new Set(owned.map((a) => a.id));
    if (ids.some((id) => !ownedIds.has(id))) {
      throw forbidden("一部の科目が存在しないか、権限がありません");
    }

    // コード変更を含む場合は、テナント内で重複しないことを確認する
    const codeChanges = body.items.filter((i) => i.code !== undefined);
    if (codeChanges.length > 0) {
      const codes = codeChanges.map((i) => i.code as string);
      if (new Set(codes).size !== codes.length) {
        throw conflict("コードが重複しています");
      }
      const dup = await db.account.findFirst({
        where: { tenantId, code: { in: codes }, id: { notIn: ids } },
        select: { code: true },
      });
      if (dup) throw conflict(`コード「${dup.code}」は既に使用されています`);
    }

    await db.$transaction(
      body.items.map((item) =>
        db.account.update({
          where: { id: item.id },
          data: {
            ...(item.code !== undefined ? { code: item.code.trim() } : {}),
            ...(item.name !== undefined ? { name: item.name.trim() } : {}),
            ...(item.category !== undefined ? { category: item.category } : {}),
            ...(item.soleName !== undefined ? { soleName: norm(item.soleName) } : {}),
            ...(item.corporateName !== undefined
              ? { corporateName: norm(item.corporateName) }
              : {}),
          },
        }),
      ),
    );
    await audit("update", `account-names:${ids.length}`);

    const accounts = await db.account.findMany({
      where: { tenantId },
      orderBy: { code: "asc" },
      select: {
        id: true,
        code: true,
        name: true,
        soleName: true,
        corporateName: true,
        category: true,
      },
    });
    return NextResponse.json({ data: accounts });
  },
});
