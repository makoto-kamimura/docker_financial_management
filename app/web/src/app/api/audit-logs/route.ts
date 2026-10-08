import { NextResponse } from "next/server";
import { prisma } from "@/lib/server/prisma";
import { withApi } from "@/lib/server/api-handler";

// GET /api/audit-logs … 監査ログ一覧（admin 限定、自分のテナントの直近 100 件）。
// 操作したユーザーは、今の表示名（userName）を添えて返す。削除されたユーザーは
// 「削除されたユーザー（#id）」、ユーザーが分からない記録（ログイン失敗など）は null。
export const GET = withApi({
  role: "admin",
  handler: async ({ user }) => {
    const logs = await prisma.auditLog.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { changedAt: "desc" },
      take: 100,
    });
    const userIds = [
      ...new Set(logs.map((l) => l.userId).filter((id): id is number => id !== null)),
    ];
    const users = await prisma.user.findMany({
      where: { id: { in: userIds }, tenantId: user.tenantId },
      select: { id: true, name: true },
    });
    const nameById = new Map(users.map((u) => [u.id, u.name]));
    return NextResponse.json({
      data: logs.map((l) => ({
        ...l,
        userName:
          l.userId === null
            ? null
            : (nameById.get(l.userId) ?? `削除されたユーザー（#${l.userId}）`),
      })),
    });
  },
});
