import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";

const UpdateSchema = z.object({
  name: z.string().min(1).optional(),
  category: z.string().optional(),
  disposedOn: z.string().nullable().optional(),
});

// GET /api/fixed-assets/[id] … 固定資産 1 件の取得
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const asset = await db.fixedAsset.findUnique({
      where: { id, tenantId: user.tenantId },
      include: { depreciations: { orderBy: { fiscalYear: "asc" } } },
    });
    if (!asset) throw notFound();
    return NextResponse.json({ data: asset });
  },
});

// PUT /api/fixed-assets/[id] … 固定資産の更新（除却日設定を含む、editor 以上）
export const PUT = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const existing = await db.fixedAsset.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    const asset = await db.fixedAsset.update({
      where: { id },
      data: {
        ...(body.name !== undefined && { name: body.name }),
        ...(body.category !== undefined && { category: body.category }),
        ...(body.disposedOn !== undefined && {
          disposedOn: body.disposedOn ? new Date(body.disposedOn) : null,
        }),
      },
    });
    return NextResponse.json({ data: asset });
  },
});

// DELETE /api/fixed-assets/[id] … 固定資産の削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.fixedAsset.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!existing) throw notFound();

    await db.fixedAsset.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
