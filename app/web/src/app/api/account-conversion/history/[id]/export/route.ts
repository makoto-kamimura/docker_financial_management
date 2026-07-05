import { NextRequest, NextResponse } from "next/server";
import { requireRole } from "@/lib/authz";
import { getSessionDetail } from "@/lib/account-conversion";

export async function GET(_: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id } = await params;
  const { tenantId, id: userId } = auth.user;
  const detail = await getSessionDetail(Number(id), tenantId, userId);
  if (!detail) return NextResponse.json({ error: "not found" }, { status: 404 });

  const header = "homeCode,homeName,corporateCode,corporateName,matchType,confidenceScore,isConvertible,isManuallyOverridden";
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
}
