import { NextResponse } from "next/server";
import Papa from "papaparse";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import {
  badRequest,
  CASH_CSV_GONE_MESSAGE,
  DIRECT_ACTUALS_GONE_MESSAGE,
  gone,
  notFound,
} from "@/lib/server/api-error";
import { BANK, insertExternalEntries, planExternalEntries } from "@/lib/ledger/ledger-entries";
import { checkStatementBalances } from "@/lib/ledger/balance-check";
import { bankBalanceOf, toNumber } from "@/lib/ledger/bank-balance";
import { MAX_CSV_BYTES, MAX_IMPORT_ROWS } from "@/lib/server/import";
import { parseLedgerRows } from "@/lib/ledger/ledger-import";
import { checkRateLimit, rateLimitResponse } from "@/lib/server/rate-limit";
import { invalidateCache } from "@/lib/server/redis";
import { invalidateActualsCaches } from "@/lib/server/closing-cache";

// POST /api/imports?target=bank|card&accountId= … 実績管理の取り込み（銀行・カードの明細の CSV）。
//   画面で選んだ口座・カードに入れる。CSV は 日付,摘要,金額[,残高]（lib/ledger/ledger-import.ts。
//   各社の CSV は画面でこの形にそろえて送る）。誤りが 1 行でもあれば何も取り込まない。
//   同じ明細は重複として飛ばし、実績を確定済みの月の行も飛ばす。学習ルールで科目が付いた行は、
//   そのまま実績になる。取り込んだ日付の明細に自動相殺をかける。
//   結果の skipped は重複で飛ばした件数、locked は確定済みの月のため飛ばした件数、offset は振替・チャージの組にした数。
//   現金（target=cash。レシートの読み取りに替えた）と、科目×月への直接の取り込み（target=actual）は 410。
//   dryRun=1 は書き込まずに、取り込む前の確認に出す preview を返す（lib/ledger/ledger-entries.ts の planExternalEntries）:
//     期間（from・to）、新しく入る件数（fresh）・取り込み済み（duplicate）・確定済みの月（locked）、
//     取り込み済みかもしれない行（possibleDuplicates）、銀行は残高の照合（balanceCheck。lib/ledger/balance-check.ts）
export const POST = withApi({
  role: "editor",
  querySchema: z.object({
    target: z.enum(["actual", "cash", "bank", "card"]),
    accountId: z.coerce.number().int().positive().optional(),
    // 1 なら、学習ルールが事業利用を決めていない明細を事業利用で取り込む（個人事業主モードの画面から）
    business: z
      .enum(["0", "1"])
      .optional()
      .transform((v) => v === "1"),
    dryRun: z
      .enum(["0", "1"])
      .optional()
      .transform((v) => v === "1"),
  }),
  handler: async ({ req, user, db, query, audit }) => {
    const { tenantId } = user;
    if (query.target === "actual") throw gone(DIRECT_ACTUALS_GONE_MESSAGE);
    if (query.target === "cash") throw gone(CASH_CSV_GONE_MESSAGE);
    const kind = query.target === "bank" ? "BANK" : "CARD";
    const account =
      query.accountId === undefined
        ? null
        : kind === "BANK"
          ? await db.bankAccount.findFirst({ where: { id: query.accountId, tenantId } })
          : await db.linkedAccount.findFirst({ where: { id: query.accountId, tenantId } });
    if (!account) throw notFound("取り込み先の口座が見つかりません");

    // S-9: ユーザー単位のレート制限（10 回 / 10 分）。試し取り込みは CSV を入れるたびに呼ぶので別に数える（30 回 / 10 分）
    const rate = query.dryRun
      ? await checkRateLimit(`rl:import-preview:user:${user.id}`, 30, 600)
      : await checkRateLimit(`rl:import:user:${user.id}`, 10, 600);
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
    const { rows, errors } = parseLedgerRows(parsed.data, account.id);
    if (errors.length > 0) {
      return NextResponse.json({ result: null, errors }, { status: 400 });
    }
    if (query.dryRun) {
      const [plan, balanceCheck] = await Promise.all([
        planExternalEntries(db, tenantId, { kind, accountId: account.id }, rows),
        kind === "BANK" ? checkBalances(db, account.id, rows) : Promise.resolve(null),
      ]);
      const dates = rows.map((r) => r.date).sort();
      return NextResponse.json({
        preview: { from: dates[0] ?? null, to: dates.at(-1) ?? null, ...plan, balanceCheck },
      });
    }

    const { inserted, locked, offset } = await insertExternalEntries(
      db,
      tenantId,
      { kind, accountId: account.id },
      rows,
      "CSV",
      { business: query.business },
    );
    if (kind === "BANK") await invalidateCache(`assets:summary:${tenantId}:*`);
    await invalidateActualsCaches(tenantId);
    await audit("import", `${query.target}:${account.id}:${inserted}`);
    return NextResponse.json(
      {
        result: { inserted, skipped: rows.length - inserted - locked, locked, offset },
        errors: [],
      },
      { status: 201 },
    );
  },
});

/**
 * 残高の照合。CSV の行のつながりと、最初の行の直前の残高をアプリの残高（差額 + その日より前の明細の合計）と比べる。
 * hasEarlier はその日より前の明細があるか（無ければ初めての取り込みで、差額を直すと合う）
 */
async function checkBalances(
  db: Parameters<typeof planExternalEntries>[0],
  bankAccountId: number,
  rows: { date: string; amount: number; balance?: number }[],
) {
  const checked = checkStatementBalances(rows);
  if (!checked) return null;
  const before = { ...BANK, bankAccountId, date: { lt: new Date(checked.opening.date) } };
  const [account, sum, earlier] = await Promise.all([
    db.bankAccount.findUniqueOrThrow({
      where: { id: bankAccountId },
      select: { balanceAdjustment: true },
    }),
    db.financialRecord.aggregate({ where: before, _sum: { flow: true } }),
    db.financialRecord.count({ where: before }),
  ]);
  const app = Math.round(bankBalanceOf(sum._sum.flow, account.balanceAdjustment));
  return {
    gaps: checked.gaps,
    opening: {
      date: checked.opening.date,
      csv: checked.opening.balance,
      app,
      diff: checked.opening.balance - app,
      adjustment: toNumber(account.balanceAdjustment),
      hasEarlier: earlier > 0,
    },
  };
}
