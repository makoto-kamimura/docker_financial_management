import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

const TransferSchema = z
  .object({
    fromAccountId: z.number().int().nullable().optional(),
    toAccountId: z.number().int().nullable().optional(),
    amount: z.number().positive(),
    kind: z.enum(["MANUAL", "AUTO"]).default("AUTO"),
    channel: z
      .enum(["BANK_TRANSFER", "AUTO_DEBIT", "CARD_PAYMENT", "INCOME", "EXPENSE"])
      .default("BANK_TRANSFER"),
    label: z.string().optional(),
    day: z.number().int().min(1).max(31),
    note: z.string().optional(),
  })
  .refine((d) => d.fromAccountId != null || d.toAccountId != null, {
    message: "出金元または入金先のいずれかは口座を指定してください",
  })
  .refine((d) => !(d.fromAccountId != null && d.fromAccountId === d.toAccountId), {
    message: "出金元と入金先が同じです",
  });

// GET /api/transfers … 資金移動ルール一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const transfers = await db.transfer.findMany({
      where: { tenantId: user.tenantId },
      include: { fromAccount: true, toAccount: true },
      orderBy: [{ day: "asc" }, { id: "asc" }],
    });
    return NextResponse.json({ data: transfers });
  },
});

// POST /api/transfers … 資金移動ルールの登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: TransferSchema,
  handler: async ({ user, db, body, audit }) => {
    const transfer = await db.transfer.create({ data: { tenantId: user.tenantId, ...body } });
    await audit("create", `transfer:${transfer.id}`);
    return NextResponse.json({ data: transfer }, { status: 201 });
  },
});
