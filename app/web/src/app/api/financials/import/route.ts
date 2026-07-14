import { NextResponse } from "next/server";
import { importRows, parseCsv } from "@/lib/import";
import { withApi } from "@/lib/api-handler";
import { badRequest } from "@/lib/api-error";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";

// POST /api/financials/import … 実績 CSV 一括取込
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, audit }) => {
    // S-9: ユーザー単位のレート制限（10 回 / 10 分）
    const rate = await checkRateLimit(`rl:import:user:${user.id}`, 10, 600);
    if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);

    const csv = await req.text();
    if (!csv.trim()) throw badRequest("empty body");

    const rows = parseCsv(csv);
    const result = await importRows(rows, user.tenantId);
    await audit("import", `financial_records:${result.inserted}`);
    return NextResponse.json(result, { status: result.errors.length ? 207 : 201 });
  },
});
