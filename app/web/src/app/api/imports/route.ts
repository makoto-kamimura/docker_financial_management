import { NextResponse } from "next/server";
import Papa from "papaparse";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, DIRECT_ACTUALS_GONE_MESSAGE, gone, notFound } from "@/lib/api-error";
import { parseBankCsv, type ParsedTxn } from "@/lib/banktxn-import";
import { insertExternalEntries } from "@/lib/ledger-entries";
import { MAX_CSV_BYTES, MAX_IMPORT_ROWS } from "@/lib/import";
import { hasTargetColumn, routeLedgerRows } from "@/lib/ledger-import";
import { checkRateLimit, rateLimitResponse } from "@/lib/rate-limit";
import { invalidateCache } from "@/lib/redis";

// skipped は重複で飛ばした件数、locked は実績を確定済みの月のため飛ばした件数
type Counted = { id: number; name: string; inserted: number; skipped: number; locked: number };

// POST /api/imports?target=bank|card&accountId= … 実績管理の CSV インポート（銀行・カードの明細）。
//   CSV に target 列があれば、行ごとに銀行・カードへ振り分ける（lib/ledger-import.ts）。
//   無ければ、画面で選んだ登録先（target）と口座（accountId）に取り込む。
//   誤りが 1 行でもあれば何も取り込まない。同じ明細は重複として飛ばし、実績を確定済みの月の行も飛ばす。
//   学習ルールで科目が付いた行は、そのまま実績になる。target=actual（科目×月への直接の取り込み）は 410。
export const POST = withApi({
  role: "editor",
  querySchema: z.object({
    target: z.enum(["actual", "bank", "card"]).default("bank"),
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

    // 振り分け: 登録先の列があれば行ごと、無ければ画面で選んだ登録先へまとめて
    const bankRows = new Map<number, ParsedTxn[]>();
    const cardRows = new Map<number, ParsedTxn[]>();
    if (hasTargetColumn(parsed.meta.fields)) {
      const routed = routeLedgerRows(parsed.data, { bankAccounts, cards });
      if (routed.errors.length > 0) {
        return NextResponse.json({ results: null, errors: routed.errors }, { status: 400 });
      }
      for (const [id, rows] of routed.bank) bankRows.set(id, rows);
      for (const [id, rows] of routed.card) cardRows.set(id, rows);
    } else {
      const list = query.target === "bank" ? bankAccounts : cards;
      const account = list.find((a) => a.id === query.accountId);
      if (!account) throw notFound("取り込み先の口座が見つかりません");
      const { rows, errors } = parseBankCsv(csv, account.id);
      if (errors.length > 0) return NextResponse.json({ results: null, errors }, { status: 400 });
      (query.target === "bank" ? bankRows : cardRows).set(account.id, rows);
    }

    const nameOf = (list: { id: number; name: string }[], id: number) =>
      list.find((a) => a.id === id)?.name ?? "";
    const bank: Counted[] = [];
    for (const [id, rows] of bankRows) {
      const { inserted, locked } = await insertExternalEntries(
        db,
        tenantId,
        { kind: "BANK", accountId: id },
        rows,
        "CSV",
      );
      bank.push({
        id,
        name: nameOf(bankAccounts, id),
        inserted,
        skipped: rows.length - inserted - locked,
        locked,
      });
    }
    const card: Counted[] = [];
    for (const [id, rows] of cardRows) {
      const { inserted, locked } = await insertExternalEntries(
        db,
        tenantId,
        { kind: "CARD", accountId: id },
        rows,
        "CSV",
      );
      card.push({
        id,
        name: nameOf(cards, id),
        inserted,
        skipped: rows.length - inserted - locked,
        locked,
      });
    }
    if (bank.length > 0) await invalidateCache(`assets:summary:${tenantId}:*`);

    const total = [...bank, ...card].reduce((s, r) => s + r.inserted, 0);
    await audit("import", `ledger:${total}`);
    return NextResponse.json(
      { results: { actual: null, bank, card }, errors: [] },
      { status: 201 },
    );
  },
});
