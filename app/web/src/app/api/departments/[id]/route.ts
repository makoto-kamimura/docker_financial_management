import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  manager: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const deptId = parseInt(id, 10);
  if (isNaN(deptId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { tenantId } = auth.user;
  const existing = await prisma.department.findUnique({ where: { id: deptId, tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const parsed = UpdateSchema.safeParse(await req.json());
  if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

  const dept = await prisma.department.update({ where: { id: deptId }, data: parsed.data });
  await writeAudit(auth.user.id, "update", `department:${deptId}`);
  return NextResponse.json({ data: dept });
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const deptId = parseInt(id, 10);
  if (isNaN(deptId)) return NextResponse.json({ error: "invalid id" }, { status: 400 });

  const { tenantId } = auth.user;
  const existing = await prisma.department.findUnique({ where: { id: deptId, tenantId } });
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });

  const hasRecords = await prisma.financialRecord.findFirst({ where: { departmentId: deptId, tenantId } });
  if (hasRecords) {
    return NextResponse.json({ error: "実績データが存在するため削除できません" }, { status: 409 });
  }

  await prisma.department.delete({ where: { id: deptId } });
  await writeAudit(auth.user.id, "delete", `department:${deptId}`);
  return new NextResponse(null, { status: 204 });
}
