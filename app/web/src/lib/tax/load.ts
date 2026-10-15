// 控除・確定申告のページの読み込み（帳簿の年合計・保存した入力・制度の値・見込み）。
// 画面の API（/api/tax-return）と申告書の PDF（/api/tax-return/forms）で同じものを使う。
import { estimateTax } from "@/lib/shared/tax-estimate";
import { parseStoredInputs } from "@/lib/tax/inputs";
import { loadTaxLedger } from "@/lib/tax/ledger";
import { loadRules } from "@/lib/tax/rules";
import type { TenantDbClient } from "@/lib/server/tenant-db";

export async function loadTaxReturn(
  db: TenantDbClient,
  tenantId: number,
  year: number,
  opts: { sole: boolean },
) {
  const [ledger, stored, resolved] = await Promise.all([
    loadTaxLedger(db, tenantId, year, opts),
    db.taxReturnInput.findUnique({ where: { tenantId_taxYear: { tenantId, taxYear: year } } }),
    loadRules(db, tenantId, year),
  ]);
  const inputs = parseStoredInputs(stored?.inputs, year);
  return {
    year,
    ledger,
    inputs,
    rules: resolved.rules,
    rulesInfo: {
      baseYear: resolved.baseYear,
      fallback: resolved.fallback,
      changed: resolved.changed,
    },
    estimate: estimateTax(resolved.rules, year, ledger, inputs),
  };
}
