import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const dividends = await prisma.dividend.findMany({
    where: { tenantId },
    include: { tenant: { select: { id: true, name: true } } },
    orderBy: { resolutionDate: "desc" },
  });
  return NextResponse.json({ data: dividends });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const body = (await req.json()) as { resolutionDate: string; paymentDate: string; perShareAmount: number; totalAmount: number; note?: string };
  if (!body.resolutionDate || !body.paymentDate || !body.totalAmount) {
    return NextResponse.json({ error: "resolutionDate, paymentDate, totalAmount are required" }, { status: 400 });
  }

  const div = await prisma.dividend.create({
    data: {
      tenantId,
      resolutionDate: new Date(body.resolutionDate),
      paymentDate: new Date(body.paymentDate),
      perShareAmount: body.perShareAmount ?? 0,
      totalAmount: body.totalAmount,
      note: body.note ?? null,
    },
  });
  return NextResponse.json({ data: div }, { status: 201 });
}
