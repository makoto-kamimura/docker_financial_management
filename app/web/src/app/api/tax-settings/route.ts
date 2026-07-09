import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const yearParam = req.nextUrl.searchParams.get("year");
  if (yearParam) {
    const setting = await db.taxSetting.findUnique({
      where: { tenantId_taxYear: { tenantId, taxYear: Number(yearParam) } },
    });
    return NextResponse.json({ data: setting });
  }

  const settings = await db.taxSetting.findMany({
    where: { tenantId },
    orderBy: { taxYear: "desc" },
  });
  return NextResponse.json({ data: settings });
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const body = (await req.json()) as {
    taxYear: number;
    taxationType: string;
    simplifiedRate?: number | null;
  };

  if (!body.taxYear || !body.taxationType) {
    return NextResponse.json({ error: "taxYear and taxationType are required" }, { status: 400 });
  }

  const setting = await db.taxSetting.upsert({
    where: { tenantId_taxYear: { tenantId, taxYear: body.taxYear } },
    update: { taxationType: body.taxationType, simplifiedRate: body.simplifiedRate ?? null },
    create: {
      tenantId,
      taxYear: body.taxYear,
      taxationType: body.taxationType,
      simplifiedRate: body.simplifiedRate ?? null,
    },
  });

  return NextResponse.json({ data: setting });
}
