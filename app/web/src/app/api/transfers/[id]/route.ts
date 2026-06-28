import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const PatchSchema = z.object({
  fromAccountId: z.number().int().nullable().optional(),
  toAccountId: z.number().int().nullable().optional(),
  amount: z.number().positive().optional(),
  kind: z.enum(["MANUAL", "AUTO"]).optional(),
  channel: z.enum(["BANK_TRANSFER", "AUTO_DEBIT", "CARD_PAYMENT", "INCOME", "EXPENSE"]).optional(),
  label: z.string().optional(),
  day: z.number().int().min(1).max(31).optional(),
  note: z.string().optional(),
});

// PATCH /api/transfers/:id
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const id = Number((await params).id);
  const parsed = PatchSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const transfer = await prisma.transfer.update({ where: { id }, data: parsed.data });
  await writeAudit(auth.user.id, "update", `transfer:${id}`);
  return NextResponse.json({ data: transfer });
}

// DELETE /api/transfers/:id
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const id = Number((await params).id);
  await prisma.transfer.delete({ where: { id } });
  await writeAudit(auth.user.id, "delete", `transfer:${id}`);
  return NextResponse.json({ ok: true });
}
