import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const assets = await prisma.fixedAsset.findMany({
    where: { tenantId },
    include: { depreciations: { orderBy: { fiscalYear: "asc" } } },
    orderBy: { acquiredOn: "desc" },
  });
  return NextResponse.json({ data: assets });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const body = (await req.json()) as {
    name: string;
    category?: string;
    acquiredOn: string;
    acquisitionCost: number;
    usefulLife: number;
    method?: string;
    residualRate?: number;
  };

  if (!body.name || !body.acquiredOn || !body.acquisitionCost || !body.usefulLife) {
    return NextResponse.json(
      { error: "name, acquiredOn, acquisitionCost, usefulLife are required" },
      { status: 400 },
    );
  }

  const asset = await prisma.fixedAsset.create({
    data: {
      tenantId,
      name: body.name,
      category: body.category ?? "tangible",
      acquiredOn: new Date(body.acquiredOn),
      acquisitionCost: body.acquisitionCost,
      usefulLife: body.usefulLife,
      method: body.method ?? "straight",
      residualRate: body.residualRate ?? 0.1,
      bookValue: body.acquisitionCost,
    },
  });
  return NextResponse.json({ data: asset }, { status: 201 });
}
