// 申告書の転記用の中身（./build.ts）に渡すものを読む。見込み・入力に加えて、医療費控除の明細書と
// ワンストップ特例申請書に使う帳簿の明細と、セルフメディケーション税制の明細書に使う保存したレシート。
import { actualRows } from "@/lib/ledger/actuals";
import { actualWhere } from "@/lib/ledger/scope";
import { loadSelfMedicationReceipts } from "@/lib/tax/documents";
import { loadTaxReturn } from "@/lib/tax/load";
import { TAX_LEDGER_CODES } from "@/lib/tax/ledger";
import type { TenantDbClient } from "@/lib/server/tenant-db";
import type { FormContext, LedgerEntry } from "./build";

/** その年の帳簿の明細（実績）を科目コードで読む。日付が無い行（直接入力の実績）は月の 1 日にする */
async function loadEntries(
  db: TenantDbClient,
  tenantId: number,
  year: number,
  codes: readonly string[],
): Promise<LedgerEntry[]> {
  const rows = actualRows(
    await db.financialRecord.findMany({
      where: {
        tenantId,
        ...actualWhere("household"),
        period: { fiscalYear: year },
        account: { code: { in: [...codes] } },
      },
      select: {
        amount: true,
        accountId: true,
        date: true,
        description: true,
        account: { select: { code: true } },
        period: { select: { month: true } },
      },
      orderBy: [{ date: "asc" }, { id: "asc" }],
    }),
  );
  return rows
    .map((r) => ({
      date:
        r.date?.toISOString().slice(0, 10) ??
        `${year}-${String(r.period.month).padStart(2, "0")}-01`,
      payee: (r.description ?? "").trim(),
      code: r.account.code,
      amount: Math.round(Number(r.amount)),
    }))
    .filter((e) => e.amount !== 0);
}

export async function loadFormContext(
  db: TenantDbClient,
  tenantId: number,
  year: number,
  opts: { sole: boolean },
): Promise<FormContext> {
  const [base, medicalEntries, furusatoEntries, receipts] = await Promise.all([
    loadTaxReturn(db, tenantId, year, opts),
    loadEntries(db, tenantId, year, TAX_LEDGER_CODES.medical),
    loadEntries(db, tenantId, year, TAX_LEDGER_CODES.furusato),
    loadSelfMedicationReceipts(db, tenantId, year),
  ]);
  return {
    year,
    estimate: base.estimate,
    inputs: base.inputs,
    ledger: base.ledger,
    medicalEntries,
    furusatoEntries,
    selfMedicationReceipts: receipts,
  };
}
