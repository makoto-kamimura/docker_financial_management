import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const CATEGORIES = ["REVENUE", "COGS", "EXPENSE", "PROFIT", "ASSET", "LIABILITY", "OTHER"] as const;

const AccountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(CATEGORIES).default("OTHER"),
  parentCode: z.string().optional(), // 親勘定科目のコード（省略可）
});

// GET /api/accounts … 勘定科目一覧（要ログイン）
// children を含む階層データを返す
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const accounts = await prisma.account.findMany({
    orderBy: { code: "asc" },
    include: {
      parent: { select: { id: true, code: true, name: true } },
    },
  });
  return NextResponse.json({ data: accounts });
}

// POST /api/accounts … 勘定科目の登録（editor 以上）
// parentCode を指定すると parent.id を解決して parentId をセットする
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = AccountSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }

  const { parentCode, ...fields } = parsed.data;

  let parentId: number | undefined;
  if (parentCode) {
    const parent = await prisma.account.findUnique({ where: { code: parentCode } });
    if (!parent) {
      return NextResponse.json({ error: `unknown parentCode: ${parentCode}` }, { status: 400 });
    }
    parentId = parent.id;
  }

  const account = await prisma.account.create({ data: { ...fields, parentId } });
  await writeAudit(auth.user.id, "create", `account:${account.id}`);
  return NextResponse.json({ data: account }, { status: 201 });
}
