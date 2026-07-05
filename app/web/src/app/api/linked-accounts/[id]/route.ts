import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const TYPES = ["BANK", "CREDIT_CARD"] as const;

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  type: z.enum(TYPES).optional(),
  institution: z.string().min(1).optional(),
  lastFour: z.string().max(4).optional().nullable(),
  accountCode: z.string().optional().nullable(),
  note: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const itemId = parseInt(id, 10);
  if (isNaN(itemId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { tenantId } = auth.user;
  const existing = await prisma.linkedAccount.findUnique({ where: { id: itemId, tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = UpdateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const { accountCode, ...fields } = parsed.data;
  let accountId: number | null | undefined;
  if (accountCode === null || accountCode === "") {
    accountId = null;
  } else if (accountCode) {
    const acct = await prisma.account.findUnique({
      where: { tenantId_code: { tenantId, code: accountCode } },
    });
    if (!acct) return NextResponse.json({ error: `unknown accountCode: ${accountCode}` }, { status: 400 });
    accountId = acct.id;
  }

  const item = await prisma.linkedAccount.update({
    where: { id: itemId },
    data: { ...fields, ...(accountId !== undefined ? { accountId } : {}) },
    include: { account: { select: { id: true, code: true, name: true } } },
  });
  await writeAudit(auth.user.id, "update", `linked_account:${itemId}`);
  return NextResponse.json({ data: item });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const itemId = parseInt(id, 10);
  if (isNaN(itemId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { tenantId } = auth.user;
  const existing = await prisma.linkedAccount.findUnique({ where: { id: itemId, tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.linkedAccount.delete({ where: { id: itemId } });
  await writeAudit(auth.user.id, "delete", `linked_account:${itemId}`);
  return new NextResponse(null, { status: 204 });
}
