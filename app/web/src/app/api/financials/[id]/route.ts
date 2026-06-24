import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const UpdateSchema = z.object({ amount: z.number() });

// GET /api/financials/[id]/history は /api/financials/[id]/history/route.ts で実装

// PATCH /api/financials/[id] … 実績データの更新（editor 以上）
export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const recordId = parseInt(id, 10);
  if (isNaN(recordId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const parsed = UpdateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const record = await prisma.financialRecord.update({
    where: { id: recordId },
    data: { amount: parsed.data.amount },
  });
  await prisma.financialRecordHistory.create({
    data: { recordId, userId: auth.user.id, action: "update", amount: parsed.data.amount },
  });
  await writeAudit(auth.user.id, "update", `financial_record:${recordId}`);
  return NextResponse.json({ data: record });
}

// DELETE /api/financials/[id] … 実績データの削除（editor 以上）
export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const recordId = parseInt(id, 10);
  if (isNaN(recordId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const record = await prisma.financialRecord.findUnique({ where: { id: recordId } });
  if (!record) return NextResponse.json({ error: "not found" }, { status: 404 });

  await prisma.financialRecordHistory.create({
    data: { recordId, userId: auth.user.id, action: "delete", amount: record.amount },
  });
  await prisma.financialRecord.delete({ where: { id: recordId } });
  await writeAudit(auth.user.id, "delete", `financial_record:${recordId}`);
  return new NextResponse(null, { status: 204 });
}
