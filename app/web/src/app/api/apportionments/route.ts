import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/apportionments
export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const list = await prisma.apportionment.findMany({
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
    orderBy: { account: { code: "asc" } },
  });
  return NextResponse.json({ data: list });
}

// POST /api/apportionments — 作成または更新（accountId で upsert）
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

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
    where: { accountId: body.accountId },
    update: { businessRate: body.businessRate, description: body.description ?? null },
    create: {
      accountId: body.accountId,
      businessRate: body.businessRate,
      description: body.description ?? null,
    },
    include: { account: { select: { id: true, code: true, name: true, category: true } } },
  });
  return NextResponse.json({ data: record });
}

// DELETE /api/apportionments?accountId=123
export async function DELETE(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const accountId = Number(req.nextUrl.searchParams.get("accountId"));
  if (!accountId) return NextResponse.json({ error: "accountId is required" }, { status: 400 });

  await prisma.apportionment.delete({ where: { accountId } });
  return NextResponse.json({ ok: true });
}
