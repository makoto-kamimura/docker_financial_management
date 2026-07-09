import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";

export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const profile = await db.businessProfile.findUnique({ where: { tenantId } });
  return NextResponse.json({ data: profile });
}

export async function PUT(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const body = (await req.json()) as {
    tradeName?: string;
    ownerName?: string;
    openedOn?: string | null;
    blueReturn?: boolean;
    invoiceNumber?: string | null;
    taxationType?: string;
  };

  const data = {
    tradeName: body.tradeName ?? "",
    ownerName: body.ownerName ?? "",
    openedOn: body.openedOn ? new Date(body.openedOn) : null,
    blueReturn: body.blueReturn ?? false,
    invoiceNumber: body.invoiceNumber ?? null,
    taxationType: body.taxationType ?? "exempt",
  };

  const profile = await db.businessProfile.upsert({
    where: { tenantId },
    update: data,
    create: { tenantId, ...data },
  });

  return NextResponse.json({ data: profile });
}
