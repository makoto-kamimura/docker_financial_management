import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

export async function GET(_req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const tenants = await prisma.tenant.findMany({ orderBy: { id: "asc" } });
  return NextResponse.json({ data: tenants });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
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
  return NextResponse.json({ data: tenant }, { status: 201 });
}
