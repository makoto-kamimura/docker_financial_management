import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/assets?year=2025
// ASSET/LIABILITY カテゴリの勘定科目について、指定年の月次残高を返す。
// 指定年が省略された場合は全年を返す。
//
// レスポンス:
// {
//   years: number[],
//   accounts: {
//     id, code, name, category, parentId,
//     parent: { code, name } | null,
//     balances: { fiscalYear, month, amount }[]
//   }[]
// }
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const yearParam = req.nextUrl.searchParams.get("year");
  const year = yearParam ? parseInt(yearParam, 10) : undefined;

  const accounts = await prisma.account.findMany({
    where: { category: { in: ["ASSET", "LIABILITY"] } },
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

  // 利用可能な年一覧（全 ASSET/LIABILITY レコードから収集）
  const allYears = await prisma.period.findMany({
    where: {
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
