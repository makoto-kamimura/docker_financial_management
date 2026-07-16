import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api-handler";
import { forbidden, notFound } from "@/lib/api-error";

const UpdateSchema = z.object({
  type: z.string().optional(),
  name: z.string().optional(),
  corporateNumber: z.string().optional(),
  capitalAmount: z.number().optional(),
  establishedOn: z.string().optional(),
  closingMonth: z.number().int().min(1).max(12).optional(),
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
export const PUT = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, id, body }) => {
    if (id !== user.tenantId) throw forbidden();

    const tenant = await prisma.tenant.update({
      where: { id },
      data: {
        ...(body.type && { type: body.type }),
        ...(body.name && { name: body.name }),
        corporateNumber: body.corporateNumber ?? undefined,
        capitalAmount: body.capitalAmount ?? undefined,
        establishedOn: body.establishedOn ? new Date(body.establishedOn) : undefined,
        ...(body.closingMonth !== undefined && { closingMonth: body.closingMonth }),
      },
    });
    return NextResponse.json({ data: tenant });
  },
});

// DELETE /api/tenants/[id] … テナントの削除（admin）
export const DELETE = withApi({
  role: "admin",
  handler: async ({ id }) => {
    await prisma.tenant.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
