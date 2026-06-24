import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const CATEGORIES = ["REVENUE", "COGS", "EXPENSE", "PROFIT", "ASSET", "LIABILITY", "OTHER"] as const;

const UpdateSchema = z.object({
  code:       z.string().min(1).max(20).optional(),
  name:       z.string().min(1).optional(),
  category:   z.enum(CATEGORIES).optional(),
  parentCode: z.string().optional().nullable(),
});

// PATCH /api/accounts/[id] … 勘定科目の更新（editor 以上）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const accountId = parseInt(id, 10);
  if (isNaN(accountId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const parsed = UpdateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { parentCode, code, ...fields } = parsed.data;

  const before = await prisma.account.findUnique({ where: { id: accountId } });
  if (!before) return NextResponse.json({ error: "not found" }, { status: 404 });

  // コード変更時の重複チェック
  if (code && code !== before.code) {
    const dup = await prisma.account.findUnique({ where: { code } });
    if (dup) return NextResponse.json({ error: `コード「${code}」は既に使用されています` }, { status: 409 });
  }

  let parentId: number | null | undefined;
  if (parentCode === null || parentCode === "") {
    parentId = null;
  } else if (parentCode) {
    const parent = await prisma.account.findUnique({ where: { code: parentCode } });
    if (!parent) return NextResponse.json({ error: `unknown parentCode: ${parentCode}` }, { status: 400 });
    if (parent.id === accountId) return NextResponse.json({ error: "cannot self-reference" }, { status: 400 });
    parentId = parent.id;
  }

  const account = await prisma.account.update({
    where: { id: accountId },
    data: { ...(code ? { code } : {}), ...fields, ...(parentId !== undefined ? { parentId } : {}) },
  });
  await writeAudit(auth.user.id, "update", `account:${accountId}`, { before, after: account });
  return NextResponse.json({ data: account });
}

// DELETE /api/accounts/[id] … 勘定科目の削除（editor 以上）
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const accountId = parseInt(id, 10);
  if (isNaN(accountId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const hasRecords = await prisma.financialRecord.findFirst({ where: { accountId } });
  if (hasRecords) {
    return NextResponse.json({ error: "実績データが存在するため削除できません" }, { status: 409 });
  }
  const hasChildren = await prisma.account.findFirst({ where: { parentId: accountId } });
  if (hasChildren) {
    return NextResponse.json({ error: "子勘定科目が存在するため削除できません" }, { status: 409 });
  }

  const before = await prisma.account.findUnique({ where: { id: accountId } });
  await prisma.account.delete({ where: { id: accountId } });
  await writeAudit(auth.user.id, "delete", `account:${accountId}`, { before });
  return new NextResponse(null, { status: 204 });
}
