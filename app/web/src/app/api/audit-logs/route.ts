import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api-handler";

// GET /api/audit-logs … 監査ログ一覧（admin 限定、直近 100 件）。
export const GET = withApi({
  role: "admin",
  handler: async () => {
    const logs = await prisma.auditLog.findMany({
      orderBy: { changedAt: "desc" },
      take: 100,
    });
    return NextResponse.json({ data: logs });
  },
});
