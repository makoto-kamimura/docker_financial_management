import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const DepartmentSchema = z.object({
  name: z.string().min(1),
  parentId: z.number().int().optional(),
});

// GET /api/departments … 部門一覧
export async function GET() {
  const departments = await prisma.department.findMany({ orderBy: { id: "asc" } });
  return NextResponse.json({ data: departments });
}

// POST /api/departments … 部門の登録
export async function POST(req: NextRequest) {
  const parsed = DepartmentSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const department = await prisma.department.create({ data: parsed.data });
  return NextResponse.json({ data: department }, { status: 201 });
}
