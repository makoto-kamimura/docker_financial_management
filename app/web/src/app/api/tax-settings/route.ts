import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/tax-settings?year=2026 — 年度別消費税設定取得（全年度またはクエリ指定）
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const yearParam = req.nextUrl.searchParams.get("year");
  if (yearParam) {
    const setting = await prisma.taxSetting.findUnique({
      where: { taxYear: Number(yearParam) },
    });
    return NextResponse.json({ data: setting });
  }

  const settings = await prisma.taxSetting.findMany({ orderBy: { taxYear: "desc" } });
  return NextResponse.json({ data: settings });
}

// PUT /api/tax-settings — 年度別消費税設定の作成/更新（upsert）
export async function PUT(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const body = (await req.json()) as {
    taxYear: number;
    taxationType: string;
    simplifiedRate?: number | null;
  };

  if (!body.taxYear || !body.taxationType) {
    return NextResponse.json({ error: "taxYear and taxationType are required" }, { status: 400 });
  }

  const setting = await prisma.taxSetting.upsert({
    where: { taxYear: body.taxYear },
    update: { taxationType: body.taxationType, simplifiedRate: body.simplifiedRate ?? null },
    create: {
      taxYear: body.taxYear,
      taxationType: body.taxationType,
      simplifiedRate: body.simplifiedRate ?? null,
    },
  });

  return NextResponse.json({ data: setting });
}
