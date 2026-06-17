import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const AccountSchema = z.object({
  code: z.string().min(1),
  name: z.string().min(1),
  category: z.enum(["REVENUE", "COGS", "EXPENSE", "PROFIT", "OTHER"]).default("OTHER"),
});

// GET /api/accounts … 勘定科目一覧
export async function GET() {
  const accounts = await prisma.account.findMany({ orderBy: { code: "asc" } });
  return NextResponse.json({ data: accounts });
}

// POST /api/accounts … 勘定科目の登録
export async function POST(req: NextRequest) {
  const parsed = AccountSchema.safeParse(await req.json());
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const account = await prisma.account.create({ data: parsed.data });
  return NextResponse.json({ data: account }, { status: 201 });
}
