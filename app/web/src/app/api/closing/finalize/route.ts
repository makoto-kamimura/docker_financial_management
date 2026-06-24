import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { invalidateCache } from "@/lib/redis";

// POST /api/closing/finalize — 年度決算を確定
// body: { fiscalYear, netIncome }
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const body = await req.json() as { fiscalYear: number; netIncome: number };
  if (!body.fiscalYear) {
    return NextResponse.json({ error: "fiscalYear is required" }, { status: 400 });
  }

  const existing = await prisma.fiscalYearClose.findUnique({ where: { fiscalYear: body.fiscalYear } });
  if (existing?.status === "closed") {
    return NextResponse.json({ error: `${body.fiscalYear}年度は既に決算確定済みです` }, { status: 400 });
  }

  const close = await prisma.fiscalYearClose.upsert({
    where:  { fiscalYear: body.fiscalYear },
    update: { status: "closed", closedAt: new Date(), netIncome: body.netIncome },
    create: { fiscalYear: body.fiscalYear, status: "closed", closedAt: new Date(), netIncome: body.netIncome },
  });

  // 決算確定でキャッシュを無効化
  await invalidateCache(`closing:statements:${body.fiscalYear}`);
  await invalidateCache(`reports:ledger:${body.fiscalYear}:*`);

  return NextResponse.json({ data: close });
}

// DELETE /api/closing/finalize — 決算取消（再開放）
export async function DELETE(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const fiscalYear = Number(req.nextUrl.searchParams.get("year"));
  if (!fiscalYear) return NextResponse.json({ error: "year is required" }, { status: 400 });

  const close = await prisma.fiscalYearClose.upsert({
    where:  { fiscalYear },
    update: { status: "open", closedAt: null },
    create: { fiscalYear, status: "open" },
  });
  return NextResponse.json({ data: close });
}
