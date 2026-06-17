import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const AccountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["REVENUE", "COGS", "EXPENSE", "PROFIT", "OTHER"]).default("OTHER"),
});

// GET /api/accounts … 勘定科目一覧（要ログイン）
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const accounts = await prisma.account.findMany({ orderBy: { code: "asc" } });
  return NextResponse.json({ data: accounts });
}

// POST /api/accounts … 勘定科目の登録（editor 以上）
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = AccountSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const account = await prisma.account.create({ data: parsed.data });
  await writeAudit(auth.user.id, "create", `account:${account.id}`);
  return NextResponse.json({ data: account }, { status: 201 });
}
