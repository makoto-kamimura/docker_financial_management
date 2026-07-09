import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const DepartmentSchema = z.object({
  name: z.string().min(1),
  manager: z.string().optional(),
  parentId: z.number().int().optional(),
});

export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const departments = await db.department.findMany({
    where: { tenantId },
    orderBy: { id: "asc" },
  });
  return NextResponse.json({ data: departments });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = DepartmentSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const department = await db.department.create({ data: { tenantId, ...parsed.data } });
  await writeAudit(auth.user.id, "create", `department:${department.id}`);
  return NextResponse.json({ data: department }, { status: 201 });
}
