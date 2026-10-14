// 所得税・住民税の控除額などの値を、既定値（lib/shared/tax-rules.ts）とテナントの上書き（TaxRuleOverride）から決める。
import {
  DEFAULT_RULE_YEARS,
  defaultRulesFor,
  resolveRules,
  type TaxRuleOverride,
} from "@/lib/shared/tax-rules";
import type { TenantDbClient } from "@/lib/server/tenant-db";

export async function loadOverride(
  db: TenantDbClient,
  tenantId: number,
  year: number,
): Promise<TaxRuleOverride | null> {
  const row = await db.taxRuleOverride.findUnique({
    where: { tenantId_taxYear: { tenantId, taxYear: year } },
  });
  return (row?.values as TaxRuleOverride | undefined) ?? null;
}

export async function loadRules(db: TenantDbClient, tenantId: number, year: number) {
  return resolveRules(year, await loadOverride(db, tenantId, year));
}

/** 設定の「税制設定」に返す、その年の値（既定値・上書き・重ねた値）と、上書きのある年の一覧 */
export async function rulesPayload(db: TenantDbClient, tenantId: number, year: number) {
  const [override, rows] = await Promise.all([
    loadOverride(db, tenantId, year),
    db.taxRuleOverride.findMany({
      where: { tenantId },
      select: { taxYear: true },
      orderBy: { taxYear: "asc" },
    }),
  ]);
  const base = defaultRulesFor(year);
  const resolved = resolveRules(year, override);
  return {
    year,
    defaults: base.rules,
    override: override ?? {},
    rules: resolved.rules,
    baseYear: resolved.baseYear,
    fallback: resolved.fallback,
    changed: resolved.changed,
    defaultYears: DEFAULT_RULE_YEARS,
    overrideYears: rows.map((r) => r.taxYear),
  };
}
