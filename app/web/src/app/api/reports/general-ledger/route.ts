import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";
import { withCache } from "@/lib/redis";

export async function GET(req: NextRequest) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const sp = req.nextUrl.searchParams;
  const accountId = sp.get("accountId") ? Number(sp.get("accountId")) : undefined;
  const year = Number(sp.get("year") ?? new Date().getFullYear());
  const format = sp.get("format") ?? "json";
  const cacheKey = format === "json" ? `reports:ledger:${tenantId}:${year}:${accountId ?? "all"}` : null;

  const startDate = new Date(`${year}-01-01T00:00:00.000Z`);
  const endDate = new Date(`${year}-12-31T23:59:59.999Z`);

  const computeLedger = async () => {
    const details = await prisma.journalDetail.findMany({
      where: {
        ...(accountId ? { accountId } : {}),
        journalEntry: { tenantId, transactionDate: { gte: startDate, lte: endDate } },
      },
      include: {
        account: { select: { id: true, code: true, name: true } },
        journalEntry: { select: { id: true, transactionDate: true, description: true } },
      },
      orderBy: [{ journalEntry: { transactionDate: "asc" } }, { id: "asc" }],
    });

    type LedgerRow = {
      date: string;
      journalId: number;
      description: string;
      debit: number;
      credit: number;
      balance: number;
    };
    type Ledger = {
      accountId: number;
      code: string;
      name: string;
      rows: LedgerRow[];
      totalDebit: number;
      totalCredit: number;
    };

    const ledgers = new Map<number, Ledger>();
    for (const d of details) {
      const aid = d.accountId;
      if (!ledgers.has(aid)) {
        ledgers.set(aid, { accountId: aid, code: d.account.code, name: d.account.name, rows: [], totalDebit: 0, totalCredit: 0 });
      }
      const l = ledgers.get(aid)!;
      const amt = Number(d.amount);
      if (d.side === "debit") l.totalDebit += amt;
      if (d.side === "credit") l.totalCredit += amt;
    }

    for (const l of ledgers.values()) {
      let balance = 0;
      const rows = details
        .filter((d) => d.accountId === l.accountId)
        .map((d) => {
          const debit = d.side === "debit" ? Number(d.amount) : 0;
          const credit = d.side === "credit" ? Number(d.amount) : 0;
          balance += debit - credit;
          return {
            date: d.journalEntry.transactionDate.toISOString().slice(0, 10),
            journalId: d.journalEntry.id,
            description: d.journalEntry.description,
            debit,
            credit,
            balance,
          };
        });
      l.rows = rows;
    }

    return [...ledgers.values()];
  };

  const result = cacheKey ? await withCache(cacheKey, 3600, computeLedger) : await computeLedger();

  if (format === "csv") {
    const lines = ["科目コード,科目名,日付,仕訳ID,摘要,借方,貸方,残高"];
    for (const l of result) {
      for (const r of l.rows) {
        lines.push(
          `${l.code},${l.name},${r.date},${r.journalId},"${r.description}",${r.debit},${r.credit},${r.balance}`,
        );
      }
    }
    return new NextResponse(lines.join("\n"), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="general-ledger-${year}.csv"`,
      },
    });
  }

  return NextResponse.json({ data: result, year });
}
