import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const CATEGORIES = ["REVENUE", "COGS", "EXPENSE", "PROFIT", "ASSET", "LIABILITY", "OTHER"] as const;

const AccountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(CATEGORIES).default("OTHER"),
  parentCode: z.string().optional(),
  soleName: z.string().max(255).optional(),
  corporateName: z.string().max(255).optional(),
});

// GET /api/accounts … 勘定科目一覧（要ログイン）
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const accounts = await db.account.findMany({
    where: { tenantId },
    orderBy: { code: "asc" },
    include: {
      parent: { select: { id: true, code: true, name: true } },
    },
  });
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

  const { parentCode, ...fields } = parsed.data;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);

  let parentId: number | undefined;
  if (parentCode) {
    const parent = await db.account.findUnique({
      where: { tenantId_code: { tenantId, code: parentCode } },
    });
    if (!parent) {
      return NextResponse.json({ error: `unknown parentCode: ${parentCode}` }, { status: 400 });
    }
    parentId = parent.id;
  }

  const account = await db.account.create({ data: { tenantId, ...fields, parentId } });
  await writeAudit(auth.user.id, "create", `account:${account.id}`);
  return NextResponse.json({ data: account }, { status: 201 });
}
