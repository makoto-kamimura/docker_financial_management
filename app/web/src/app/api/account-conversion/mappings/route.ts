import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// システム定義ルール（userId=null）＋ 自分の独自ルールを一覧取得する。
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id: userId } = auth.user;
  const rules = await prisma.accountMappingRule.findMany({
    where: { OR: [{ userId }, { userId: null }] },
    orderBy: { homeCode: "asc" },
  });
  const data = rules.map((r) => ({ ...r, isOwn: r.userId === userId }));
  return NextResponse.json({ data });
}

// 手動マッピングを自分専用のルールとして登録・更新する（次回以降の自動変換に反映される）。
export async function PUT(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id: userId } = auth.user;
  const body = (await req.json()) as {
    homeCode: string;
    corporateCode: string | null;
    isConvertible?: boolean;
    notes?: string;
  };
  if (!body.homeCode) {
    return NextResponse.json({ error: "homeCode is required" }, { status: 400 });
  }

  const rule = await prisma.accountMappingRule.upsert({
    where: { homeCode_userId: { homeCode: body.homeCode, userId } },
    update: {
      corporateCode: body.corporateCode ?? null,
      isConvertible: body.isConvertible ?? true,
      notes: body.notes ?? null,
      matchType: "MANUAL",
      confidenceScore: 1.0,
    },
    create: {
      homeCode: body.homeCode,
      userId,
      corporateCode: body.corporateCode ?? null,
      isConvertible: body.isConvertible ?? true,
      notes: body.notes ?? null,
      matchType: "MANUAL",
      confidenceScore: 1.0,
    },
  });
  return NextResponse.json({ data: rule });
}
