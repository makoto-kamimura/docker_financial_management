import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { badRequest } from "@/lib/api-error";
import { resolvePeriod, findAccountByCode } from "@/lib/period";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// POST /api/budgets/import … 予算 CSV 一括取込（accountCode,fiscalYear,month,amount）
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, db, audit }) => {
    // S-9: ユーザー単位のレート制限（10 回 / 10 分）
    const rate = await checkRateLimit(`rl:import:user:${user.id}`, 10, 600);
    if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

    const { tenantId } = user;
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) throw badRequest("file が必要です");

    const text = await file.text();
    const lines = text.trim().split(/\r?\n/);
    if (lines.length < 2) throw badRequest("データ行がありません");

    const errors: string[] = [];
    let imported = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
      const [accountCode, fiscalYearStr, monthStr, amountStr] = cols;
      const fiscalYear = parseInt(fiscalYearStr, 10);
      const month = parseInt(monthStr, 10);
      const amount = parseFloat(amountStr);

      if (
        !accountCode ||
        isNaN(fiscalYear) ||
        isNaN(month) ||
        month < 1 ||
        month > 12 ||
        isNaN(amount)
      ) {
        errors.push(`行${i + 1}: 無効なデータ (${lines[i]})`);
        continue;
      }

      const account = await findAccountByCode(db, tenantId, accountCode);
      if (!account) {
        errors.push(`行${i + 1}: 不明な勘定科目コード "${accountCode}"`);
        continue;
      }

      const period = await resolvePeriod(db, tenantId, fiscalYear, month);

      await db.budget.upsert({
        where: {
          tenantId_accountId_periodId: { tenantId, accountId: account.id, periodId: period.id },
        },
        update: { amount },
        create: { tenantId, accountId: account.id, periodId: period.id, amount },
      });

      imported++;
    }

    await audit("import", `budgets:csv:${imported}`);
    return NextResponse.json({ imported, errors });
  },
});
