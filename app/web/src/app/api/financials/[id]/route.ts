import { withApi } from "@/lib/api-handler";
import { DIRECT_ACTUALS_GONE_MESSAGE, gone } from "@/lib/api-error";

// PATCH・DELETE /api/financials/[id] … 実績の行の直接の変更・削除。
// 実績は明細（現金・銀行・カード）に科目を付けると入るようにしたため、科目×月の行を直接は変えない（410）。
// 明細の科目は各明細の categorize から、仕訳由来の実績は仕訳から変える。
export const PATCH = withApi({
  role: "editor",
  handler: async () => {
    throw gone(DIRECT_ACTUALS_GONE_MESSAGE);
  },
});

export const DELETE = withApi({
  role: "editor",
  handler: async () => {
    throw gone(DIRECT_ACTUALS_GONE_MESSAGE);
  },
});
