import { NextResponse } from "next/server";
import { importRows, parseCsv, MAX_CSV_BYTES, MAX_IMPORT_ROWS } from "@/lib/import";
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

    // S-11: Content-Length で事前拒否（ボディを読む前にサイズ超過を検出する）
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_CSV_BYTES) {
      throw badRequest("ファイルサイズが上限（5MB）を超えています。分割して取込してください。");
    }

    const csv = await req.text();
    if (!csv.trim()) throw badRequest("empty body");

    const rows = parseCsv(csv);
    if (rows.length > MAX_IMPORT_ROWS) {
      throw badRequest(
        `行数が上限（${MAX_IMPORT_ROWS}行）を超えています。分割して取込してください。`,
      );
    }

    // S-11: エラー行が 1 行でもあれば全体を中止する（inserted は 0 か全件のいずれか）
    const result = await importRows(rows, user.tenantId);
    await audit("import", `financial_records:${result.inserted}`);
    return NextResponse.json(result, { status: result.errors.length ? 400 : 201 });
  },
});
