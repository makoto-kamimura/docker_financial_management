import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { PERSONAL_ASSET_CATEGORIES } from "@/lib/personal-asset";
import { badRequest, notFound } from "@/lib/api-error";
import { zYearMonth } from "@/lib/zod-helpers";
import { invalidateCache } from "@/lib/redis";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.enum(PERSONAL_ASSET_CATEGORIES).optional(),
  acquiredOn: z.string().nullable().optional(),
  acquisitionCost: z.number().nullable().optional(),
  currentValue: z.number().optional(),
  note: z.string().nullable().optional(),
  linkedAccountId: z.number().int().nullable().optional(),
  debtStartOn: zYearMonth.nullable().optional(), // 支払い開始年月（"YYYY-MM"）
  debtPayoffDue: zYearMonth.nullable().optional(), // 負債解消予定年月（"YYYY-MM"）
  debtInitialAmount: z.number().min(0).nullable().optional(), // 当初負債額
});

// PATCH /api/personal-assets/[id] … 実物資産の更新（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const { tenantId } = user;
    const existing = await db.personalAsset.findUnique({ where: { id, tenantId } });
    if (!existing) throw notFound();

    if (body.linkedAccountId !== undefined && body.linkedAccountId !== null) {
      const account = await db.account.findFirst({
        where: { id: body.linkedAccountId, tenantId },
      });
      if (!account) throw badRequest(`invalid linkedAccountId: ${body.linkedAccountId}`);
    }

    // 更新後の開始・解消予定の組み合わせで前後関係を検証する
    const nextStartOn = body.debtStartOn !== undefined ? body.debtStartOn : existing.debtStartOn;
    const nextPayoffDue =
      body.debtPayoffDue !== undefined ? body.debtPayoffDue : existing.debtPayoffDue;
    if (nextStartOn && nextPayoffDue && nextStartOn > nextPayoffDue) {
      throw badRequest("debtStartOn must be before or equal to debtPayoffDue");
    }

    const asset = await db.personalAsset.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.acquiredOn !== undefined && {
          acquiredOn: body.acquiredOn ? new Date(body.acquiredOn) : null,
        }),
        ...(body.acquisitionCost !== undefined && { acquisitionCost: body.acquisitionCost }),
        ...(body.currentValue !== undefined && { currentValue: body.currentValue }),
        ...(body.note !== undefined && { note: body.note }),
        ...(body.linkedAccountId !== undefined && { linkedAccountId: body.linkedAccountId }),
        ...(body.debtStartOn !== undefined && { debtStartOn: body.debtStartOn }),
        ...(body.debtPayoffDue !== undefined && { debtPayoffDue: body.debtPayoffDue }),
        ...(body.debtInitialAmount !== undefined && { debtInitialAmount: body.debtInitialAmount }),
      },
    });
    await invalidateCache(`assets:summary:${tenantId}:*`);
    return NextResponse.json({ data: asset });
  },
});

// DELETE /api/personal-assets/[id] … 実物資産の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.personalAsset.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.personalAsset.delete({ where: { id } });
    await invalidateCache(`assets:summary:${user.tenantId}:*`);
    return NextResponse.json({ ok: true });
  },
});
