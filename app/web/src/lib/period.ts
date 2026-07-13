import type { TenantDb } from "@/lib/tenant-db";
import { badRequest } from "@/lib/api-error";

// 会計期間（fiscalYear × month）を解決する。無ければ quarter を自動計算して作成する。
// budgets / financials / actuals / import で繰り返されていた upsert パターンの共通化。
export function resolvePeriod(db: TenantDb, tenantId: number, fiscalYear: number, month: number) {
  return db.period.upsert({
    where: { tenantId_fiscalYear_month: { tenantId, fiscalYear, month } },
    update: {},
    create: { tenantId, fiscalYear, month, quarter: Math.ceil(month / 3) },
  });
}

// 勘定科目をコードで解決する（自テナントのみ）。
export function findAccountByCode(db: TenantDb, tenantId: number, code: string) {
  return db.account.findUnique({ where: { tenantId_code: { tenantId, code } } });
}

// findAccountByCode の必須版。見つからなければ 400 を throw する。
export async function requireAccountByCode(db: TenantDb, tenantId: number, code: string) {
  const account = await findAccountByCode(db, tenantId, code);
  if (!account) throw badRequest(`unknown accountCode: ${code}`);
  return account;
}
