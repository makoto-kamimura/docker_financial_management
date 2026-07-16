import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";

const SuggestSchema = z.object({ description: z.string().min(1) });

// 摘要キーワードによる仕訳提案ルール（過去仕訳が無い場合のフォールバック）
const RULES: { keywords: string[]; debitCode: string; creditCode: string; label: string }[] = [
  { keywords: ["売上", "販売", "請求"], debitCode: "1300", creditCode: "4000", label: "売上計上" },
  { keywords: ["仕入", "購入", "買掛"], debitCode: "5000", creditCode: "3000", label: "仕入計上" },
  { keywords: ["現金", "入金", "回収"], debitCode: "1000", creditCode: "1300", label: "現金入金" },
  {
    keywords: ["振込", "振替", "預金", "送金"],
    debitCode: "1100",
    creditCode: "1300",
    label: "預金入金",
  },
  { keywords: ["支払", "出金", "払"], debitCode: "3000", creditCode: "1100", label: "代金支払" },
  { keywords: ["給与", "給料", "賞与"], debitCode: "8000", creditCode: "1100", label: "給与支払" },
  { keywords: ["家賃", "賃料", "地代"], debitCode: "8100", creditCode: "1100", label: "地代家賃" },
  {
    keywords: ["交通", "旅費", "出張"],
    debitCode: "8200",
    creditCode: "1000",
    label: "旅費交通費",
  },
  {
    keywords: ["通信", "電話", "インターネット"],
    debitCode: "8100",
    creditCode: "1100",
    label: "通信費",
  },
  {
    keywords: ["消耗", "消費", "備品"],
    debitCode: "8100",
    creditCode: "1100",
    label: "消耗品費",
  },
];

// POST /api/journals/suggest … 摘要から仕訳を提案（過去仕訳 → キーワードルール）
export const POST = withApi({
  role: "viewer",
  schema: SuggestSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;
    const q = body.description.toLowerCase();

    const pastEntries = await db.journalEntry.findMany({
      where: { tenantId, description: { contains: body.description, mode: "insensitive" } },
      include: {
        details: {
          include: { account: { select: { id: true, code: true, name: true, category: true } } },
        },
      },
      orderBy: { transactionDate: "desc" },
      take: 5,
    });

    if (pastEntries.length > 0) {
      const entry = pastEntries[0];
      const toLine = (d: (typeof entry.details)[number]) => ({
        accountId: d.accountId,
        accountCode: d.account.code,
        accountName: d.account.name,
        amount: Number(d.amount),
      });
      return NextResponse.json({
        data: {
          source: "history",
          description: entry.description,
          debit: entry.details.filter((d) => d.side === "debit").map(toLine),
          credit: entry.details.filter((d) => d.side === "credit").map(toLine),
        },
      });
    }

    for (const rule of RULES) {
      if (rule.keywords.some((k) => q.includes(k))) {
        const [debitAcc, creditAcc] = await Promise.all([
          db.account.findFirst({ where: { tenantId, code: rule.debitCode } }),
          db.account.findFirst({ where: { tenantId, code: rule.creditCode } }),
        ]);
        if (debitAcc && creditAcc) {
          return NextResponse.json({
            data: {
              source: "rule",
              label: rule.label,
              debit: [
                {
                  accountId: debitAcc.id,
                  accountCode: debitAcc.code,
                  accountName: debitAcc.name,
                  amount: null,
                },
              ],
              credit: [
                {
                  accountId: creditAcc.id,
                  accountCode: creditAcc.code,
                  accountName: creditAcc.name,
                  amount: null,
                },
              ],
            },
          });
        }
      }
    }

    return NextResponse.json({ data: null });
  },
});
