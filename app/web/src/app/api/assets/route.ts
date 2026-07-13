import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

// GET /api/assets?year=2025 … 資産・負債の科目別残高（純資産推移）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ year: z.coerce.number().int().optional() }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const year = query.year;

    const accounts = await db.account.findMany({
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

    const allYears = await db.period.findMany({
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
  },
});
