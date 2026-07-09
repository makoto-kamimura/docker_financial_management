import { NextResponse } from "next/server";
import { tenantDb } from "@/lib/tenant-db";
import { requireRole } from "@/lib/authz";
import { isHomeAccountCode, suggestConversions } from "@/lib/account-conversion";

// 現在のテナントに存在する家庭モード科目（H-prefix）について、
// 法人科目への変換候補を提案する（DB への書き込みは行わない）。
export async function GET() {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { tenantId, id: userId } = auth.user;
  const db = tenantDb(tenantId);
  const accounts = await db.account.findMany({ where: { tenantId } });
  const homeAccounts = accounts.filter((a) => isHomeAccountCode(a.code));
  const corporateAccounts = accounts.filter((a) => !isHomeAccountCode(a.code));

  const suggestions = await suggestConversions(userId, homeAccounts, corporateAccounts);
  return NextResponse.json({ data: suggestions });
}
