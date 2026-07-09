import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

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

export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const transfers = await db.transfer.findMany({
    where: { tenantId },
    include: { fromAccount: true, toAccount: true },
    orderBy: [{ day: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ data: transfers });
}

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = TransferSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const transfer = await db.transfer.create({ data: { tenantId, ...parsed.data } });
  await writeAudit(auth.user.id, "create", `transfer:${transfer.id}`);
  return NextResponse.json({ data: transfer }, { status: 201 });
}
