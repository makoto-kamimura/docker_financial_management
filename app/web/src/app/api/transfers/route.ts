import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { TransferCreateSchema } from "@/lib/transfer-schema";

// GET /api/transfers … 資金移動ルール一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const transfers = await db.transfer.findMany({
      where: { tenantId: user.tenantId },
      include: { fromAccount: true, toAccount: true, linkedAccount: true },
      orderBy: [{ day: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ data: transfers });
  },
});

// POST /api/transfers … 資金移動ルールの登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: TransferCreateSchema,
  handler: async ({ user, db, body, audit }) => {
    const transfer = await db.transfer.create({ data: { tenantId: user.tenantId, ...body } });
    await audit("create", `transfer:${transfer.id}`);
    return NextResponse.json({ data: transfer }, { status: 201 });
  },
});
