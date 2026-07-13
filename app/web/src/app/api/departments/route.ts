import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

const DepartmentSchema = z.object({
  name: z.string().min(1),
  manager: z.string().optional(),
  parentId: z.number().int().optional(),
});

// GET /api/departments … 部門一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const departments = await db.department.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { id: "asc" },
    });
    return NextResponse.json({ data: departments });
  },
});

// POST /api/departments … 部門の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: DepartmentSchema,
  handler: async ({ user, db, body, audit }) => {
    const department = await db.department.create({ data: { tenantId: user.tenantId, ...body } });
    await audit("create", `department:${department.id}`);
    return NextResponse.json({ data: department }, { status: 201 });
  },
});
