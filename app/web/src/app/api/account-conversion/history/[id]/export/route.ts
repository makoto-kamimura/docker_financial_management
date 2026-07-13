import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";
import { getSessionDetail } from "@/lib/account-conversion";

// GET /api/account-conversion/history/[id]/export … 変換セッションの CSV 出力
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, id }) => {
    const detail = await getSessionDetail(id, user.tenantId, user.id);
    if (!detail) throw notFound();

    const header =
      "homeCode,homeName,corporateCode,corporateName,matchType,confidenceScore,isConvertible,isManuallyOverridden";
    const lines = detail.logs.map((l) =>
      [
        l.homeAccount?.code ?? "",
        l.homeAccount?.name ?? "",
        l.corporateAccount?.code ?? "",
        l.corporateAccount?.name ?? "",
        l.matchType,
        l.confidenceScore ?? "",
        l.isConvertible,
        l.isManuallyOverridden,
      ].join(","),
    );
    const csv = [header, ...lines].join("\n");

    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="account-conversion-${id}.csv"`,
      },
    });
  },
});
