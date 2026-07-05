import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// 過去の変換セッション一覧（自分が実行したもののみ）
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id: userId } = auth.user;
  const sessions = await prisma.accountConversionSession.findMany({
    where: { userId },
    include: { logs: true },
    orderBy: { convertedAt: "desc" },
  });

  const data = sessions.map((s) => ({
    id: s.id,
    fromMode: s.fromMode,
    toMode: s.toMode,
    convertedAt: s.convertedAt,
    status: s.status,
    accountCount: s.logs.length,
    convertibleCount: s.logs.filter((l) => l.isConvertible).length,
    manualCount: s.logs.filter((l) => l.isManuallyOverridden).length,
  }));
  return NextResponse.json({ data });
}
