import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/business-profile — 事業者情報取得（なければ null）
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const profile = await prisma.businessProfile.findFirst({ orderBy: { id: "asc" } });
  return NextResponse.json({ data: profile });
}

// PUT /api/business-profile — 事業者情報作成/更新（upsert）
export async function PUT(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const body = await req.json() as {
    tradeName?: string;
    ownerName?: string;
    openedOn?: string | null;
    blueReturn?: boolean;
    invoiceNumber?: string | null;
    taxationType?: string;
  };

  const existing = await prisma.businessProfile.findFirst({ orderBy: { id: "asc" } });

  const data = {
    tradeName:     body.tradeName     ?? "",
    ownerName:     body.ownerName     ?? "",
    openedOn:      body.openedOn ? new Date(body.openedOn) : null,
    blueReturn:    body.blueReturn    ?? false,
    invoiceNumber: body.invoiceNumber ?? null,
    taxationType:  body.taxationType  ?? "exempt",
  };

  const profile = existing
    ? await prisma.businessProfile.update({ where: { id: existing.id }, data })
    : await prisma.businessProfile.create({ data });

  return NextResponse.json({ data: profile });
}
