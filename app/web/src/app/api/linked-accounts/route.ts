import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const TYPES = ["BANK", "CREDIT_CARD"] as const;

const LinkedAccountSchema = z.object({
  name: z.string().min(1),
  type: z.enum(TYPES),
  institution: z.string().min(1),
  lastFour: z.string().max(4).optional(),
  accountCode: z.string().optional(),
  note: z.string().optional(),
});

// GET /api/linked-accounts … 連携口座一覧
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const items = await prisma.linkedAccount.findMany({
    orderBy: [{ type: "asc" }, { institution: "asc" }],
    include: {
      account: { select: { id: true, code: true, name: true, category: true } },
    },
  });
  return NextResponse.json({ data: items });
}

// POST /api/linked-accounts … 連携口座を登録
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = LinkedAccountSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { accountCode, ...fields } = parsed.data;
  let accountId: number | undefined;
  if (accountCode) {
    const acct = await prisma.account.findUnique({ where: { code: accountCode } });
    if (!acct)
      return NextResponse.json({ error: `unknown accountCode: ${accountCode}` }, { status: 400 });
    accountId = acct.id;
  }

  const item = await prisma.linkedAccount.create({ data: { ...fields, accountId } });
  await writeAudit(auth.user.id, "create", `linked_account:${item.id}`);
  return NextResponse.json({ data: item }, { status: 201 });
}
