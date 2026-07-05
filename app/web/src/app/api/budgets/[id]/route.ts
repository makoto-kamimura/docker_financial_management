import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const UpdateSchema = z.object({ amount: z.number() });

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const budgetId = parseInt(id, 10);
  if (isNaN(budgetId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { tenantId } = auth.user;
  const existing = await prisma.budget.findUnique({ where: { id: budgetId, tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = UpdateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const budget = await prisma.budget.update({
    where: { id: budgetId },
    data: { amount: parsed.data.amount },
  });
  await writeAudit(auth.user.id, "update", `budget:${budgetId}`);
  return NextResponse.json({ data: budget });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const budgetId = parseInt(id, 10);
  if (isNaN(budgetId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { tenantId } = auth.user;
  const existing = await prisma.budget.findUnique({ where: { id: budgetId, tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.budget.delete({ where: { id: budgetId } });
  await writeAudit(auth.user.id, "delete", `budget:${budgetId}`);
  return new NextResponse(null, { status: 204 });
}
