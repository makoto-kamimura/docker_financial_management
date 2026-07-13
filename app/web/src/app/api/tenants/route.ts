import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api-handler";
import { seedDefaultAccountsForTenant } from "@/lib/default-accounts";
import { seedDefaultAllocationRulesForTenant } from "@/lib/default-allocation-rules";

const TenantSchema = z.object({
  type: z.string().default("SOLE_PROPRIETOR"),
  name: z.string().min(1),
  corporateNumber: z.string().optional(),
  capitalAmount: z.number().optional(),
  establishedOn: z.string().optional(),
  closingMonth: z.number().int().min(1).max(12).default(12),
});

// GET /api/tenants … 自テナントのみ返す
export const GET = withApi({
  role: "viewer",
  handler: async ({ user }) => {
    const tenant = await prisma.tenant.findUnique({ where: { id: user.tenantId } });
    return NextResponse.json({ data: tenant ? [tenant] : [] });
  },
});

// POST /api/tenants … テナント作成（admin。既定勘定科目を自動投入）
export const POST = withApi({
  role: "admin",
  schema: TenantSchema,
  handler: async ({ body }) => {
    const tenant = await prisma.tenant.create({
      data: {
        type: body.type,
        name: body.name,
        corporateNumber: body.corporateNumber ?? null,
        capitalAmount: body.capitalAmount ?? null,
        establishedOn: body.establishedOn ? new Date(body.establishedOn) : null,
        closingMonth: body.closingMonth,
      },
    });
    // 新規テナントには家庭モードの既定勘定科目一式と予算配分ルールを自動登録する
    await seedDefaultAccountsForTenant(prisma, tenant.id);
    await seedDefaultAllocationRulesForTenant(prisma, tenant.id);
    return NextResponse.json({ data: tenant }, { status: 201 });
  },
});
