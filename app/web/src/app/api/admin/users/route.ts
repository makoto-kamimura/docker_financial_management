import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { randomBytes, scryptSync } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";
import { seedDefaultAccountsForTenant } from "@/lib/default-accounts";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const derived = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${derived}`;
}

const CreateSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
  password: z.string().min(8),
  newTenant: z.boolean().optional(), // true で専用の空テナントを新規作成、既定は自テナントへ追加
});

// GET /api/admin/users … 自テナントのユーザー一覧（admin のみ）
export async function GET() {
  const auth = await requireRole("admin");
  if (auth.error) return auth.error;

  const users = await prisma.user.findMany({
    where: { tenantId: auth.user.tenantId },
    orderBy: { id: "asc" },
    select: { id: true, email: true, name: true, role: true, mfaEnabled: true, createdAt: true },
  });
  return NextResponse.json({ data: users });
}

// POST /api/admin/users … ユーザー新規作成（admin のみ）
export async function POST(req: NextRequest) {
  const auth = await requireRole("admin");
  if (auth.error) return auth.error;

  const parsed = CreateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { password, newTenant, ...fields } = parsed.data;
  const exists = await prisma.user.findUnique({ where: { email: fields.email } });
  if (exists)
    return NextResponse.json({ error: "メールアドレスが既に使用されています" }, { status: 409 });

  const user = await prisma.$transaction(async (tx) => {
    // 既定は自テナントへの追加（テナント間の分離を維持）。newTenant 指定時のみ空テナントを新設する。
    let tid = auth.user.tenantId;
    if (newTenant) {
      tid = (await tx.tenant.create({ data: { name: fields.name } })).id;
      // 新規テナントには家庭モードの既定勘定科目一式を自動登録する
      await seedDefaultAccountsForTenant(tx, tid);
    }
    return tx.user.create({
      data: { ...fields, passwordHash: hashPassword(password), tenantId: tid },
      select: { id: true, email: true, name: true, role: true, mfaEnabled: true, createdAt: true },
    });
  });
  await writeAudit(auth.user.id, "create", `user:${user.id}`);
  return NextResponse.json({ data: user }, { status: 201 });
}
