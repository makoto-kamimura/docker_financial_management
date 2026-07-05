import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/assets?year=2025
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : undefined;

  const accounts = await prisma.account.findMany({
    where: { tenantId, category: { in: ["ASSET", "LIABILITY"] } },
    orderBy: { code: "asc" },
    include: {
      parent: { select: { id: true, code: true, name: true } },
      records: {
        where: year ? { period: { fiscalYear: year } } : undefined,
        include: { period: { select: { fiscalYear: true, month: true } } },
        orderBy: [{ period: { fiscalYear: "asc" } }, { period: { month: "asc" } }],
      },
    },
  });

  const allYears = await prisma.period.findMany({
    where: {
      tenantId,
      records: {
        some: { account: { category: { in: ["ASSET", "LIABILITY"] } } },
      },
    },
    select: { fiscalYear: true },
    distinct: ["fiscalYear"],
    orderBy: { fiscalYear: "asc" },
  });

  return NextResponse.json({
    years: allYears.map((p) => p.fiscalYear),
    accounts: accounts.map((a) => ({
      id: a.id,
      code: a.code,
      name: a.name,
      category: a.category,
      parentId: a.parentId,
      parent: a.parent,
      balances: a.records.map((r) => ({
        fiscalYear: r.period.fiscalYear,
        month: r.period.month,
        amount: Number(r.amount),
      })),
    })),
  });
}
