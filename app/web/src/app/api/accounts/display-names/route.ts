import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { forbidden } from "@/lib/api-error";

// 各科目の個人事業主モード / 法人モードでの表示名を一括更新する。
// 空文字は null（＝家庭科目名 name にフォールバック）として保存する。
const BulkSchema = z.object({
  items: z
    .array(
      z.object({
        id: z.number().int().positive(),
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

// PUT /api/accounts/display-names … モード別科目表示名の一括更新（editor 以上）
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

    await db.$transaction(
      body.items.map((item) =>
        db.account.update({
          where: { id: item.id },
          data: {
            ...(item.soleName !== undefined ? { soleName: norm(item.soleName) } : {}),
            ...(item.corporateName !== undefined
              ? { corporateName: norm(item.corporateName) }
              : {}),
          },
        }),
      ),
    );
    await audit("update", `account-display-names:${ids.length}`);

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
