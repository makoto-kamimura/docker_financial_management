import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { isHomeAccountCode, suggestConversions } from "@/lib/account-conversion";

// GET /api/account-conversion/preview … 現在のテナントに存在する家庭モード科目（H-prefix）
// について、法人科目への変換候補を提案する（DB への書き込みは行わない）。
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db }) => {
    const accounts = await db.account.findMany({ where: { tenantId: user.tenantId } });
    const homeAccounts = accounts.filter((a) => isHomeAccountCode(a.code));
    const corporateAccounts = accounts.filter((a) => !isHomeAccountCode(a.code));

    const suggestions = await suggestConversions(user.id, homeAccounts, corporateAccounts);
    return NextResponse.json({ data: suggestions });
  },
});
