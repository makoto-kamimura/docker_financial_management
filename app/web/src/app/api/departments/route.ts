import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const DepartmentSchema = z.object({
  name: z.string().min(1),
  parentId: z.number().int().optional(),
});

// GET /api/departments … 部門一覧（要ログイン）
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const departments = await prisma.department.findMany({ orderBy: { id: "asc" } });
  return NextResponse.json({ data: departments });
}

// POST /api/departments … 部門の登録（editor 以上）
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = DepartmentSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const department = await prisma.department.create({ data: parsed.data });
  await writeAudit(auth.user.id, "create", `department:${department.id}`);
  return NextResponse.json({ data: department }, { status: 201 });
}
