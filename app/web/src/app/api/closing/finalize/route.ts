import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { invalidateCache } from "@/lib/redis";

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const body = (await req.json()) as { fiscalYear: number; netIncome: number };
  if (!body.fiscalYear) {
    return NextResponse.json({ error: "fiscalYear is required" }, { status: 400 });
  }

  const existing = await prisma.fiscalYearClose.findUnique({
    where: { tenantId_fiscalYear: { tenantId, fiscalYear: body.fiscalYear } },
  });
  if (existing?.status === "closed") {
    return NextResponse.json({ error: `${body.fiscalYear}年度は既に決算確定済みです` }, { status: 400 });
  }

  const close = await prisma.fiscalYearClose.upsert({
    where: { tenantId_fiscalYear: { tenantId, fiscalYear: body.fiscalYear } },
    update: { status: "closed", closedAt: new Date(), netIncome: body.netIncome },
    create: { tenantId, fiscalYear: body.fiscalYear, status: "closed", closedAt: new Date(), netIncome: body.netIncome },
  });

  await invalidateCache(`closing:statements:${tenantId}:${body.fiscalYear}`);
  await invalidateCache(`reports:ledger:${tenantId}:${body.fiscalYear}:*`);

  return NextResponse.json({ data: close });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const fiscalYear = Number(req.nextUrl.searchParams.get("year"));
  if (!fiscalYear) return NextResponse.json({ error: "year is required" }, { status: 400 });

  const close = await prisma.fiscalYearClose.upsert({
    where: { tenantId_fiscalYear: { tenantId, fiscalYear } },
    update: { status: "open", closedAt: null },
    create: { tenantId, fiscalYear, status: "open" },
  });
  return NextResponse.json({ data: close });
}
