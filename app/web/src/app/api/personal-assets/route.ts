import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest } from "@/lib/api-error";
import { zYearMonth } from "@/lib/zod-helpers";
import { computeDebtSchedule } from "@/lib/debt-schedule";

const CATEGORIES = ["LAND", "BUILDING", "VEHICLE", "GOLD", "OTHER"] as const;

const CreateSchema = z
  .object({
    name: z.string().min(1),
    category: z.enum(CATEGORIES).default("OTHER"),
    acquiredOn: z.string().optional(),
    acquisitionCost: z.number().optional(),
    currentValue: z.number(),
    note: z.string().optional(),
    linkedAccountId: z.number().int().optional(),
    debtStartOn: zYearMonth.optional(), // 支払い開始年月（"YYYY-MM"）
    debtPayoffDue: zYearMonth.optional(), // 負債解消予定年月（"YYYY-MM"）
    debtInitialAmount: z.number().min(0).optional(), // 当初負債額
  })
  .refine((d) => !(d.debtStartOn && d.debtPayoffDue && d.debtStartOn > d.debtPayoffDue), {
    message: "debtStartOn must be before or equal to debtPayoffDue",
  });

// GET /api/personal-assets … 実物資産一覧（負債スケジュール付き）
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const assets = await db.personalAsset.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "asc" },
    });
    // 負債スケジュールが設定済みの資産には、経過月数から算出した現在残高を付与する
    const data = assets.map((a) => {
      const schedule =
        a.debtInitialAmount !== null && a.debtStartOn && a.debtPayoffDue
          ? computeDebtSchedule(Number(a.debtInitialAmount), a.debtStartOn, a.debtPayoffDue)
          : null;
      return {
        ...a,
        debtMonthly: schedule?.monthly ?? null,
        debtRemaining: schedule?.remaining ?? null,
        debtRemainingMonths: schedule ? schedule.totalMonths - schedule.paidMonths : null,
      };
    });
    return NextResponse.json({ data });
  },
});

// POST /api/personal-assets … 実物資産の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: CreateSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;

    if (body.linkedAccountId !== undefined) {
      const account = await db.account.findFirst({
        where: { id: body.linkedAccountId, tenantId },
      });
      if (!account) throw badRequest(`invalid linkedAccountId: ${body.linkedAccountId}`);
    }

    const asset = await db.personalAsset.create({
      data: {
        tenantId,
        name: body.name,
        category: body.category,
        acquiredOn: body.acquiredOn ? new Date(body.acquiredOn) : null,
        acquisitionCost: body.acquisitionCost ?? null,
        currentValue: body.currentValue,
        note: body.note ?? null,
        linkedAccountId: body.linkedAccountId ?? null,
        debtStartOn: body.debtStartOn ?? null,
        debtPayoffDue: body.debtPayoffDue ?? null,
        debtInitialAmount: body.debtInitialAmount ?? null,
      },
    });
    return NextResponse.json({ data: asset }, { status: 201 });
  },
});
