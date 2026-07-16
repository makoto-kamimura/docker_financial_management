import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { hashPassword, invalidateAllSessions } from "@/lib/auth";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "editor", "viewer"]).optional(),
  password: z.string().min(8).optional(),
});

// PATCH /api/admin/users/[id] … ロール変更・パスワードリセット（admin のみ）
export const PATCH = withApi({
  role: "admin",
  schema: UpdateSchema,
  handler: async ({ user: actor, id, body, audit }) => {
    // 自テナントのユーザーのみ操作可能
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || target.tenantId !== actor.tenantId) throw notFound();

    const { password, ...fields } = body;
    const data: Record<string, unknown> = { ...fields };
    if (password) data.passwordHash = await hashPassword(password);

    const user = await prisma.user.update({
      where: { id },
      data,
      select: { id: true, email: true, name: true, role: true, mfaEnabled: true, createdAt: true },
    });

    // パスワード・ロール変更時は既存セッションを全て失効させる（変更前の権限での操作を防ぐ）
    if (password || fields.role !== undefined) {
      await invalidateAllSessions(id);
      // S-12: 詳細設計書 §8 の記録必須イベント「session_revoked_all」
      await audit("session_revoked_all", `user:${id}`);
    }

    await audit("update", `user:${id}`);
    return NextResponse.json({ data: user });
  },
});

// DELETE /api/admin/users/[id] … ユーザー削除（admin のみ、自分自身は不可）
export const DELETE = withApi({
  role: "admin",
  handler: async ({ user: actor, id, audit }) => {
    if (id === actor.id) throw badRequest("自分自身は削除できません");

    // 自テナントのユーザーのみ操作可能
    const target = await prisma.user.findUnique({ where: { id } });
    if (!target || target.tenantId !== actor.tenantId) throw notFound();

    await prisma.session.deleteMany({ where: { userId: id } });
    await prisma.user.delete({ where: { id } });
    await audit("delete", `user:${id}`);
    return new NextResponse(null, { status: 204 });
  },
});
