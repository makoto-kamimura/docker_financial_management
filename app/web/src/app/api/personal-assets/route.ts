import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

const CATEGORIES = ["LAND", "BUILDING", "VEHICLE", "GOLD", "OTHER"] as const;

export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const assets = await db.personalAsset.findMany({
    where: { tenantId },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json({ data: assets });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const body = (await req.json()) as {
    name: string;
    category?: string;
    acquiredOn?: string;
    acquisitionCost?: number;
    currentValue: number;
    note?: string;
  };

  if (!body.name || body.currentValue === undefined) {
    return NextResponse.json({ error: "name, currentValue are required" }, { status: 400 });
  }
  if (body.category && !CATEGORIES.includes(body.category as (typeof CATEGORIES)[number])) {
    return NextResponse.json({ error: `invalid category: ${body.category}` }, { status: 400 });
  }

  const asset = await db.personalAsset.create({
    data: {
      tenantId,
      name: body.name,
      category: (body.category as (typeof CATEGORIES)[number]) ?? "OTHER",
      acquiredOn: body.acquiredOn ? new Date(body.acquiredOn) : null,
      acquisitionCost: body.acquisitionCost ?? null,
      currentValue: body.currentValue,
      note: body.note ?? null,
    },
  });
  return NextResponse.json({ data: asset }, { status: 201 });
}
