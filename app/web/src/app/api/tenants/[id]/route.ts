import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/server/prisma";
import { withApi } from "@/lib/server/api-handler";
import { badRequest, conflict, forbidden, notFound } from "@/lib/server/api-error";
import { fiscalMonthsError, isValidFiscalMonths } from "@/lib/accounting/fiscal-months";

const UpdateSchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  corporateNumber: z.string().optional(),
  capitalAmount: z.number().optional(),
  establishedOn: z.string().optional(),
  closingMonth: z.number().int().min(1).max(12).optional(),
  startMonth: z.number().int().min(1).max(12).optional(),
});

// GET /api/tenants/[id] … 自テナントのみ取得可能
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, id }) => {
    if (id !== user.tenantId) throw forbidden();

    const tenant = await prisma.tenant.findUnique({ where: { id } });
    if (!tenant) throw notFound();
    return NextResponse.json({ data: tenant });
  },
});

// PUT /api/tenants/[id] … 自テナントの更新（editor 以上）
//   開始月と決算月は組で変える: どちらかを送るなら両方を送り、開始月は決算月の翌月でなければ 400
export const PUT = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, id, body }) => {
    if (id !== user.tenantId) throw forbidden();
    const { startMonth, closingMonth } = body;
    if (startMonth !== undefined || closingMonth !== undefined) {
      if (startMonth === undefined || closingMonth === undefined) {
        throw badRequest("開始月と決算月は両方を指定してください");
      }
      if (!isValidFiscalMonths(startMonth, closingMonth)) {
        throw badRequest(fiscalMonthsError(closingMonth));
      }
    }

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        ...(body.type && { type: body.type }),
        ...(body.name && { name: body.name }),
        corporateNumber: body.corporateNumber ?? undefined,
        capitalAmount: body.capitalAmount ?? undefined,
        establishedOn: body.establishedOn ? new Date(body.establishedOn) : undefined,
        ...(closingMonth !== undefined && startMonth !== undefined && { closingMonth, startMonth }),
      },
    });
    return NextResponse.json({ data: tenant });
  },
});

// DELETE /api/tenants/[id] … テナントの削除（admin）
//   有料プランの契約が残っていれば 409（消すと Stripe の請求だけが続くため、先に解約してもらう）
export const DELETE = withApi({
  role: "admin",
  handler: async ({ id }) => {
    const sub = await prisma.subscription.findUnique({ where: { tenantId: id } });
    if (sub && sub.status !== "CANCELED" && sub.status !== "INCOMPLETE") {
      throw conflict(
        "有料プランの契約があります。設定の「プランと支払い」で解約してから削除してください",
      );
    }
    await prisma.tenant.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
