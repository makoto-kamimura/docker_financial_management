import { withApi } from "@/lib/api-handler";
import { DIRECT_ACTUALS_GONE_MESSAGE, gone } from "@/lib/api-error";

// POST /api/financials/import … 実績 CSV（科目×月）の一括取込。
// 実績は明細（現金・銀行・カード）に科目を付けると入るようにしたため、直接の取り込みはやめた（410）。
export const POST = withApi({
  role: "editor",
  handler: async () => {
    throw gone(DIRECT_ACTUALS_GONE_MESSAGE);
  },
});
