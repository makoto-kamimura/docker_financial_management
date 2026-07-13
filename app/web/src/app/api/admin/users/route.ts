import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { withApi } from "@/lib/api-handler";
import { conflict } from "@/lib/api-error";
import { hashPassword } from "@/lib/auth";
import { seedDefaultAccountsForTenant } from "@/lib/default-accounts";
import { seedDefaultAllocationRulesForTenant } from "@/lib/default-allocation-rules";

const CreateSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  role: z.enum(["admin", "editor", "viewer"]).default("viewer"),
  password: z.string().min(8),
  newTenant: z.boolean().optional(), // true で専用の空テナントを新規作成、既定は自テナントへ追加
});

// GET /api/admin/users … 自テナントのユーザー一覧（admin のみ）
export const GET = withApi({
  role: "admin",
  handler: async ({ user }) => {
    const users = await prisma.user.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { id: "asc" },
      select: { id: true, email: true, name: true, role: true, mfaEnabled: true, createdAt: true },
    });
    return NextResponse.json({ data: users });
  },
});

// POST /api/admin/users … ユーザー新規作成（admin のみ）
export const POST = withApi({
  role: "admin",
  schema: CreateSchema,
  handler: async ({ user: actor, body, audit }) => {
    const { password, newTenant, ...fields } = body;
    const exists = await prisma.user.findUnique({ where: { email: fields.email } });
    if (exists) throw conflict("メールアドレスが既に使用されています");

    const user = await prisma.$transaction(async (tx) => {
      // 既定は自テナントへの追加（テナント間の分離を維持）。newTenant 指定時のみ空テナントを新設する。
      let tid = actor.tenantId;
      if (newTenant) {
        tid = (await tx.tenant.create({ data: { name: fields.name } })).id;
        // 新規テナントには家庭モードの既定勘定科目一式と予算配分ルールを自動登録する
        await seedDefaultAccountsForTenant(tx, tid);
        await seedDefaultAllocationRulesForTenant(tx, tid);
      }
      return tx.user.create({
        data: { ...fields, passwordHash: hashPassword(password), tenantId: tid },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          mfaEnabled: true,
          createdAt: true,
        },
      });
    });
    await audit("create", `user:${user.id}`);
    return NextResponse.json({ data: user }, { status: 201 });
  },
});
