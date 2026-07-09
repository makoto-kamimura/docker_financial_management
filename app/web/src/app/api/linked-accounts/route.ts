import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tenantDb } from "@/lib/tenant-db";
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

export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const items = await db.linkedAccount.findMany({
    where: { tenantId },
    orderBy: [{ type: "asc" }, { institution: "asc" }],
    include: {
      account: { select: { id: true, code: true, name: true, category: true } },
    },
  });
  return NextResponse.json({ data: items });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = LinkedAccountSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { accountCode, ...fields } = parsed.data;
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);

  let accountId: number | undefined;
  if (accountCode) {
    const acct = await db.account.findUnique({
      where: { tenantId_code: { tenantId, code: accountCode } },
    });
    if (!acct)
      return NextResponse.json({ error: `unknown accountCode: ${accountCode}` }, { status: 400 });
    accountId = acct.id;
  }

  const item = await db.linkedAccount.create({ data: { tenantId, ...fields, accountId } });
  await writeAudit(auth.user.id, "create", `linked_account:${item.id}`);
  return NextResponse.json({ data: item }, { status: 201 });
}
