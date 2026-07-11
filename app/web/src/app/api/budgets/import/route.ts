import { NextRequest, NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";
import { writeAudit } from "@/lib/audit";

export async function POST(req: NextRequest) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { tenantId } = auth.user;
  const db = tenantDb(tenantId);
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file が必要です" }, { status: 400 });

  const text = await file.text();
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2)
    return NextResponse.json({ error: "データ行がありません" }, { status: 400 });

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

    const account = await db.account.findUnique({
      where: { tenantId_code: { tenantId, code: accountCode } },
    });
    if (!account) {
      errors.push(`行${i + 1}: 不明な勘定科目コード "${accountCode}"`);
      continue;
    }

    const period = await db.period.upsert({
      where: { tenantId_fiscalYear_month: { tenantId, fiscalYear, month } },
      update: {},
      create: { tenantId, fiscalYear, month, quarter: Math.ceil(month / 3) },
    });

    await db.budget.upsert({
      where: {
        tenantId_accountId_periodId: { tenantId, accountId: account.id, periodId: period.id },
      },
      update: { amount },
      create: { tenantId, accountId: account.id, periodId: period.id, amount },
    });

    imported++;
  }

  await writeAudit(auth.user.id, "import", `budgets:csv:${imported}`);
  return NextResponse.json({ imported, errors });
}
