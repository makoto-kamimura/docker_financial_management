import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

// GET /api/reports/trial-balance?year=&month=&format=json|csv&rollup=true
// 合計残高試算表（rollup=true で親科目への集計付き）
export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const sp = req.nextUrl.searchParams;
  const year = Number(sp.get("year") ?? new Date().getFullYear());
  const month = sp.get("month") ? Number(sp.get("month")) : undefined;
  const format = sp.get("format") ?? "json";
  const rollup = sp.get("rollup") !== "false"; // デフォルト: true

  const startDate = month
    ? new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00.000Z`)
    : new Date(`${year}-01-01T00:00:00.000Z`);
  const endDate = month
    ? new Date(new Date(startDate).setMonth(startDate.getMonth() + 1) - 1)
    : new Date(`${year}-12-31T23:59:59.999Z`);

  // 全科目の親子関係を取得（ロールアップに使用）
  const allAccounts = await prisma.account.findMany({
    select: { id: true, code: true, name: true, category: true, parentId: true },
  });
  const accountById = new Map(allAccounts.map((a) => [a.id, a]));

  const details = await prisma.journalDetail.findMany({
    where: { journalEntry: { transactionDate: { gte: startDate, lte: endDate } } },
    include: {
      account: { select: { id: true, code: true, name: true, category: true, parentId: true } },
    },
  });

  // 科目別集計（リーフ科目）
  type Row = {
    id: number;
    code: string;
    name: string;
    category: string;
    parentId: number | null;
    depth: number;
    totalDebit: number;
    totalCredit: number;
    balance: number;
    isGroup: boolean;
  };

  const map = new Map<number, Row>();
  for (const d of details) {
    const a = d.account;
    if (!map.has(a.id)) {
      map.set(a.id, {
        id: a.id,
        code: a.code,
        name: a.name,
        category: a.category,
        parentId: a.parentId,
        depth: 0,
        totalDebit: 0,
        totalCredit: 0,
        balance: 0,
        isGroup: false,
      });
    }
    const r = map.get(a.id)!;
    const amt = Number(d.amount);
    if (d.side === "debit") {
      r.totalDebit += amt;
      r.balance += amt;
    }
    if (d.side === "credit") {
      r.totalCredit += amt;
      r.balance -= amt;
    }
  }

  if (rollup) {
    // 親科目へロールアップ
    for (const [, row] of map) {
      let parentId = row.parentId;
      while (parentId != null) {
        const parent = accountById.get(parentId);
        if (!parent) break;
        if (!map.has(parentId)) {
          map.set(parentId, {
            id: parentId,
            code: parent.code,
            name: parent.name,
            category: parent.category,
            parentId: parent.parentId,
            depth: 0,
            totalDebit: 0,
            totalCredit: 0,
            balance: 0,
            isGroup: true,
          });
        }
        const p = map.get(parentId)!;
        p.totalDebit += row.totalDebit;
        p.totalCredit += row.totalCredit;
        p.balance += row.balance;
        p.isGroup = true;
        parentId = parent.parentId;
      }
    }

    // 深さを計算
    for (const [, row] of map) {
      let depth = 0;
      let pId = row.parentId;
      while (pId != null) {
        const parent = accountById.get(pId);
        if (!parent) break;
        depth++;
        pId = parent.parentId;
      }
      row.depth = depth;
    }
  }

  const rows = [...map.values()].sort((a, b) => a.code.localeCompare(b.code));
  // リーフ科目のみで合計計算（グループ科目は二重計上になるため）
  const leafRows = rows.filter((r) => !r.isGroup);
  const grandDebit = leafRows.reduce((s, r) => s + r.totalDebit, 0);
  const grandCredit = leafRows.reduce((s, r) => s + r.totalCredit, 0);

  if (format === "csv") {
    const lines = ["科目コード,科目名,カテゴリ,グループ,借方合計,貸方合計,残高"];
    for (const r of rows) {
      lines.push(
        `${r.code},${r.name},${r.category},${r.isGroup ? "Y" : ""},${r.totalDebit},${r.totalCredit},${r.balance}`,
      );
    }
    lines.push(`,,合計,,,${grandDebit},${grandCredit},`);
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="trial-balance-${year}${month ? "-" + month : ""}.csv"`,
      },
    });
  }

  return NextResponse.json({ data: rows, grandDebit, grandCredit, year, month });
}
