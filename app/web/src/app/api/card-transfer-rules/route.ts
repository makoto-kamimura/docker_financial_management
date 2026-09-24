import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { notFound } from "@/lib/api-error";

// カード明細のチャージ自動判定ルール（card_transfer_rules）の一覧・削除。
//
// 作成の口はここにも他にも無い。かつては明細一覧の一括指定フォーム
// （POST /api/card-transactions/mark-transfers）だけが登録口だったが、フォームはタスク 82 で、
// API はタスク 93 で削除した。既存ルールは CSV 取込時の自動チャージ判定
// （lib/card-transfer.ts の resolveTransferTarget()）で今も参照されるため、
// 一覧して不要なものを消せる状態だけを残している。
// 再びルールを増やせるようにする場合は、ここに POST を足したうえで
// 「ルールだけ作って既存明細に反映されない」状態にならない導線を画面側に用意すること。

// GET /api/card-transfer-rules?accountId= … 指定カードのルール一覧（省略時は全カード）
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ accountId: z.coerce.number().int().positive().optional() }),
  handler: async ({ db, query }) => {
    const rules = await db.cardTransferRule.findMany({
      where: query.accountId ? { accountId: query.accountId } : {},
      orderBy: { keyword: "asc" },
      include: {
        account: { select: { id: true, name: true } },
        transferToAccount: { select: { id: true, name: true } },
      },
    });
    return NextResponse.json({ data: rules });
  },
});

// DELETE /api/card-transfer-rules?id= … ルール 1 件の削除
// 既にチャージ指定済みの明細はそのまま残る（解除は明細ごとの操作で行う）。
export const DELETE = withApi({
  role: "editor",
  querySchema: z.object({ id: z.coerce.number().int().positive() }),
  handler: async ({ db, query, audit }) => {
    const rule = await db.cardTransferRule.findUnique({ where: { id: query.id } });
    if (!rule) throw notFound();

    await db.cardTransferRule.delete({ where: { id: query.id } });
    await audit("delete_card_transfer_rule", `card_transfer_rule:${query.id}`, {
      before: { keyword: rule.keyword, transferToAccountId: rule.transferToAccountId },
    });
    return NextResponse.json({ ok: true });
  },
});
