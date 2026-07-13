import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";

// GET /api/financials/[id]/history … 実績 1 件の変更履歴
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const record = await db.financialRecord.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!record) throw notFound();

    const histories = await db.financialRecordHistory.findMany({
      where: { recordId: id },
      orderBy: { changedAt: "desc" },
      include: {
        record: {
          include: {
            account: { select: { code: true, name: true } },
            period: { select: { fiscalYear: true, month: true } },
          },
        },
      },
    });

    return NextResponse.json({ data: histories });
  },
});
