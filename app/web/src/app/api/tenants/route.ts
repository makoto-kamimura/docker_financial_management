import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { seedDefaultAccountsForTenant } from "@/lib/default-accounts";

export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  // Each user sees only their own tenant
  const { tenantId } = auth.user;
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  return NextResponse.json({ data: tenant ? [tenant] : [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("admin");
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    type?: string;
    name: string;
    corporateNumber?: string;
    capitalAmount?: number;
    establishedOn?: string;
    closingMonth?: number;
  };
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });

  const tenant = await prisma.tenant.create({
    data: {
      type: body.type ?? "SOLE_PROPRIETOR",
      name: body.name,
      corporateNumber: body.corporateNumber ?? null,
      capitalAmount: body.capitalAmount ?? null,
      establishedOn: body.establishedOn ? new Date(body.establishedOn) : null,
      closingMonth: body.closingMonth ?? 12,
    },
  });
  // 新規テナントには家庭モードの既定勘定科目一式を自動登録する
  await seedDefaultAccountsForTenant(prisma, tenant.id);
  return NextResponse.json({ data: tenant }, { status: 201 });
}
