import { NextResponse } from "next/server";
import Papa from "papaparse";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { badRequest, DIRECT_ACTUALS_GONE_MESSAGE, gone, notFound } from "@/lib/server/api-error";
import { insertExternalEntries } from "@/lib/ledger/ledger-entries";
import { MAX_CSV_BYTES, MAX_IMPORT_ROWS } from "@/lib/server/import";
import {
  CASH_DESTINATION,
  hasDestinationColumn,
  routeLedgerRows,
  type LedgerDestination,
} from "@/lib/ledger/ledger-import";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { invalidateCache } from "@/lib/server/redis";

// 取り込み先ごとの結果。skipped は重複で飛ばした件数、locked は実績を確定済みの月のため飛ばした件数、
// offset は自動相殺で振替・チャージの組にした数
type Counted = {
  kind: "CASH" | "BANK" | "CARD";
  id: number | null;
  name: string;
  inserted: number;
  skipped: number;
  locked: number;
  offset: number;
};

// POST /api/imports?target=cash|bank|card&accountId= … 実績管理の CSV インポート（現金・銀行・カードの明細）。
//   CSV に取り込み先の列（取り込み先 / account）があれば、行ごとに現金・銀行・カードへ振り分ける
//   （lib/ledger/ledger-import.ts）。無ければ、画面で選んだ取り込み先（target）と口座（accountId）に入れる。
//   誤りが 1 行でもあれば何も取り込まない。同じ明細は重複として飛ばし、実績を確定済みの月の行も飛ばす。
//   学習ルールで科目が付いた行は、そのまま実績になる。取り込んだ日付の明細に自動相殺をかける。
//   target=actual（科目×月への直接の取り込み）は 410。
export const POST = withApi({
  role: "editor",
  querySchema: z.object({
    target: z.enum(["actual", "cash", "bank", "card"]).default("bank"),
    accountId: z.coerce.number().int().positive().optional(),
  }),
  handler: async ({ req, user, db, query, audit }) => {
    const { tenantId } = user;
    // 実績は明細に科目を付けると入る。科目×月へ直接入れる取り込みはやめた
    if (query.target === "actual") throw gone(DIRECT_ACTUALS_GONE_MESSAGE);
    // S-9: ユーザー単位のレート制限（10 回 / 10 分。各画面の CSV 取込と同じ）
    const rate = await checkRateLimit(`rl:import:user:${user.id}`, 10, 600);
    if (!rate.allowed) return rateLimitResponse(rate.retryAfterSeconds);
    const contentLength = Number(req.headers.get("content-length") ?? "0");
    if (contentLength > MAX_CSV_BYTES) {
      throw badRequest("ファイルサイズが上限（5MB）を超えています。分割して取込してください。");
    }
    const csv = await req.text();
    if (!csv.trim()) throw badRequest("empty body");

    const parsed = Papa.parse<Record<string, unknown>>(csv, { header: true, skipEmptyLines: true });
    if (parsed.data.length > MAX_IMPORT_ROWS) {
      throw badRequest(
        `行数が上限（${MAX_IMPORT_ROWS}行）を超えています。分割して取込してください。`,
      );
    }

    const [bankAccounts, cards] = await Promise.all([
      db.bankAccount.findMany({ where: { tenantId }, select: { id: true, name: true } }),
      db.linkedAccount.findMany({ where: { tenantId }, select: { id: true, name: true } }),
    ]);

    // 振り分け: 取り込み先の列があれば行ごと、無ければ画面で選んだ取り込み先へまとめて
    let fixed: LedgerDestination | undefined;
    if (!hasDestinationColumn(parsed.meta.fields)) {
      if (query.target === "cash") {
        fixed = { kind: "CASH" };
      } else {
        const list = query.target === "bank" ? bankAccounts : cards;
        const account = list.find((a) => a.id === query.accountId);
        if (!account) throw notFound("取り込み先の口座が見つかりません");
        fixed = { kind: query.target === "bank" ? "BANK" : "CARD", accountId: account.id };
      }
    }
    const routed = routeLedgerRows(parsed.data, { bankAccounts, cards }, fixed);
    if (routed.errors.length > 0) {
      return NextResponse.json({ results: null, errors: routed.errors }, { status: 400 });
    }

    const nameOf = (d: LedgerDestination) =>
      d.kind === "CASH"
        ? CASH_DESTINATION
        : ((d.kind === "BANK" ? bankAccounts : cards).find((a) => a.id === d.accountId)?.name ??
          "");
    const results: Counted[] = [];
    for (const { destination, rows } of routed.groups) {
      const { inserted, locked, offset } = await insertExternalEntries(
        db,
        tenantId,
        destination,
        rows,
        "CSV",
      );
      results.push({
        kind: destination.kind,
        id: destination.kind === "CASH" ? null : destination.accountId,
        name: nameOf(destination),
        inserted,
        skipped: rows.length - inserted - locked,
        locked,
        offset,
      });
    }
    if (results.some((r) => r.kind === "BANK")) {
      await invalidateCache(`assets:summary:${tenantId}:*`);
    }

    const total = results.reduce((s, r) => s + r.inserted, 0);
    await audit("import", `ledger:${total}`);
    return NextResponse.json({ results, errors: [] }, { status: 201 });
  },
});
