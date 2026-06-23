import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

const TransferSchema = z.object({
  fromAccountId: z.number().int(),
  toAccountId: z.number().int(),
  amount: z.number().positive(),
  kind: z.enum(["MANUAL", "AUTO"]).default("AUTO"),
  day: z.number().int().min(1).max(31),
  note: z.string().optional(),
});

// GET /api/transfers … 資金移動ルール一覧（口座名を含む）
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const transfers = await prisma.transfer.findMany({
    include: { fromAccount: true, toAccount: true },
    orderBy: [{ day: "asc" }, { id: "asc" }],
  });
  return NextResponse.json({ data: transfers });
}

// POST /api/transfers … 資金移動ルールの登録（editor 以上）
export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const parsed = TransferSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  if (parsed.data.fromAccountId === parsed.data.toAccountId) {
    return NextResponse.json({ error: "出金元と入金先が同じです" }, { status: 400 });
  }
  const transfer = await prisma.transfer.create({ data: parsed.data });
  await writeAudit(auth.user.id, "create", `transfer:${transfer.id}`);
  return NextResponse.json({ data: transfer }, { status: 201 });
}
