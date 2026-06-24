import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes, scryptSync } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  role: z.enum(["admin", "editor", "viewer"]).optional(),
  password: z.string().min(8).optional(),
});

// PATCH /api/admin/users/[id] … ロール変更・パスワードリセット（admin のみ）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (auth.error) return auth.error;

  const { id } = await params;
  const userId = parseInt(id, 10);
  if (isNaN(userId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const parsed = UpdateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { password, ...fields } = parsed.data;
  const data: Record<string, unknown> = { ...fields };
  if (password) data.passwordHash = hashPassword(password);

  const user = await prisma.user.update({
    where: { id: userId },
    data,
    select: { id: true, email: true, name: true, role: true, mfaEnabled: true, createdAt: true },
  });
  await writeAudit(auth.user.id, "update", `user:${userId}`);
  return NextResponse.json({ data: user });
}

// DELETE /api/admin/users/[id] … ユーザー削除（admin のみ、自分自身は不可）
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("admin");
  if (auth.error) return auth.error;

  const { id } = await params;
  const userId = parseInt(id, 10);
  if (isNaN(userId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });
  if (userId === auth.user.id) return NextResponse.json({ error: "自分自身は削除できません" }, { status: 400 });

  await prisma.session.deleteMany({ where: { userId } });
  await prisma.user.delete({ where: { id: userId } });
  await writeAudit(auth.user.id, "delete", `user:${userId}`);
  return new NextResponse(null, { status: 204 });
}
