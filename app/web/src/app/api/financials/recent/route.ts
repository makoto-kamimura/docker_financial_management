import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/financials/recent?limit=20
// 最近登録・更新された実績データを返す（モバイル・履歴ウィジェット用）
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const limit = parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10);

  const histories = await prisma.financialRecordHistory.findMany({
    orderBy: { changedAt: "desc" },
    take: limit,
    include: {
      record: {
        include: {
          account: { select: { code: true, name: true, category: true } },
          period: { select: { fiscalYear: true, month: true } },
        },
      },
    },
  });

  return NextResponse.json({
    data: histories.map((h) => ({
      historyId: h.id,
      recordId: h.recordId,
      action: h.action,
      amount: Number(h.amount),
      changedAt: h.changedAt,
      userId: h.userId,
      account: h.record.account,
      period: h.record.period,
    })),
  });
}
