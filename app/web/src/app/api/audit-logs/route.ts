import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/audit-logs … 監査ログ一覧（admin 限定、直近 100 件）。
export async function GET() {
  const auth = await requireRole("admin");
  if (auth.error) return auth.error;

  const logs = await prisma.auditLog.findMany({
    orderBy: { changedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({ data: logs });
}
