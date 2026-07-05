import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const list = await prisma.apportionment.findMany({
    where: { tenantId },
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
    orderBy: { account: { code: "asc" } },
  });
  return NextResponse.json({ data: list });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const body = (await req.json()) as {
    accountId: number;
    businessRate: number;
    description?: string;
  };

  if (!body.accountId || body.businessRate === undefined) {
    return NextResponse.json({ error: "accountId and businessRate are required" }, { status: 400 });
  }
  if (body.businessRate < 0 || body.businessRate > 100) {
    return NextResponse.json({ error: "businessRate must be 0-100" }, { status: 400 });
  }

  const record = await prisma.apportionment.upsert({
    where: { tenantId_accountId: { tenantId, accountId: body.accountId } },
    update: { businessRate: body.businessRate, description: body.description ?? null },
    create: {
      tenantId,
      accountId: body.accountId,
      businessRate: body.businessRate,
      description: body.description ?? null,
    },
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
  });
  return NextResponse.json({ data: record });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const accountId = Number(req.nextUrl.searchParams.get("accountId"));
  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });

  await prisma.apportionment.delete({
    where: { tenantId_accountId: { tenantId, accountId } },
  });
  return NextResponse.json({ ok: true });
}
