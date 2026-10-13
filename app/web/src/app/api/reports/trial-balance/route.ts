import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { ScopeQuery } from "@/lib/ledger/scope";
import { loadAutoBook } from "@/lib/accounting/auto-journal-data";
import { buildTrialBalance } from "@/lib/accounting/auto-journal";

// GET /api/reports/trial-balance?year=&month=&format=&rollup= … 試算表（親科目ロールアップ対応）
//   scope=business（個人事業主モード）は、実績から作った仕訳の年度の試算表（lib/accounting/auto-journal.ts）。
//   month・rollup は使わない。income は損益の科目から求めた所得で、決算書の所得と一致する。
export const GET = withApi({
  role: "viewer",
  querySchema: ScopeQuery.extend({
    year: z.coerce.number().int().optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
    format: z.enum(["json", "csv"]).default("json"),
    rollup: z.string().optional(),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const year = query.year ?? new Date().getFullYear();
    const { month, format } = query;
    const rollup = query.rollup !== "false";

    if (query.scope === "business") {
      const tb = buildTrialBalance(await loadAutoBook(db, tenantId, year));
      if (format === "csv") {
        const lines = ["科目コード,科目名,補助科目,区分,借方合計,貸方合計,残高"];
        for (const r of tb.rows) {
          lines.push(
            [
              r.account.code,
              r.account.name,
              r.account.sub ?? "",
              r.account.category,
              r.debit,
              r.credit,
              r.balance,
            ].join(","),
          );
        }
        lines.push(`,,,合計,${tb.totalDebit},${tb.totalCredit},`);
        return new NextResponse(lines.join("\n"), {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="trial-balance-${year}.csv"`,
          },
        });
      }
      return NextResponse.json({ data: tb, year });
    }

    const startDate = month
      ? new Date(`${year}-${String(month).padStart(2, "0")}-01T00:00:00.000Z`)
      : new Date(`${year}-01-01T00:00:00.000Z`);
    const endDate = month
      ? new Date(new Date(startDate).setMonth(startDate.getMonth() + 1) - 1)
      : new Date(`${year}-12-31T23:59:59.999Z`);

    const allAccounts = await db.account.findMany({
      where: { tenantId },
      select: { id: true, code: true, name: true, category: true, parentId: true },
    });
    const accountById = new Map(allAccounts.map((a) => [a.id, a]));

    const details = await db.journalDetail.findMany({
      where: { journalEntry: { tenantId, transactionDate: { gte: startDate, lte: endDate } } },
      include: {
        account: { select: { id: true, code: true, name: true, category: true, parentId: true } },
      },
    });

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
  },
});
