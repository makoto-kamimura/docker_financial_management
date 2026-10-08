import type { QueryClient } from "@tanstack/react-query";

// 明細の科目を変える・明細を登録・削除すると実績が変わる（科目が付いた明細がそのまま実績のため）。
// 実績を読んでいる画面のキャッシュをまとめて取り直す。
const ACTUALS_QUERY_KEYS = [
  "actuals",
  "financials-matrix",
  "budget-variance",
  "cycle-status",
  "cycle-latest",
  "kpi",
  "cash-outlook",
  "allocation-suggest",
  "allocation-guide",
  "assets-summary",
  "portal",
] as const;

export function invalidateActuals(qc: QueryClient) {
  for (const key of ACTUALS_QUERY_KEYS) qc.invalidateQueries({ queryKey: [key] });
}
