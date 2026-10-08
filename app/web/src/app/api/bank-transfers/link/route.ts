import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { BANK } from "@/lib/ledger/ledger-entries";
import { invalidateCache } from "@/lib/server/redis";

// DELETE /api/bank-transfers/link … 振替の組（transferGroupId）を解除して、もとの独立した 2 明細に戻す。
// 組は、同じ日・同じ金額の出金と入金が 1 組だけのときに自動で作られる（lib/ledger/auto-offset.ts）。
// 明細そのものは消さないので、口座残高（明細合計 + 差額）は変わらない。
// 変わるのは「収入・支出として集計されるかどうか」だけ。

export const DELETE = withApi({
  role: "editor",
  querySchema: z.object({ transferGroupId: z.string().min(1) }),
  handler: async ({ user, db, query, audit }) => {
    const { tenantId } = user;
    const { transferGroupId } = query;

    const txns = await db.financialRecord.findMany({
      where: { transferGroupId, ...BANK },
      select: { id: true },
    });
    if (txns.length === 0) throw notFound("振替が見つかりません");

    // 明細は残したまま対だけ外す。以後それぞれ科目を付けられる（付けた明細が実績になる）ようになり、
    // 削除も 1 行ずつになる（紐付いている間は片方を消すと相手も一緒に消える）
    await db.financialRecord.updateMany({
      where: { id: { in: txns.map((t) => t.id) } },
      data: { transferGroupId: null },
    });

    await audit("unlink_bank_transfer", `bank_transfer:${transferGroupId}`, {
      before: { transferGroupId, txnIds: txns.map((t) => t.id) },
    });
    await invalidateCache(`assets:summary:${tenantId}:*`);

    return NextResponse.json({ ok: true, count: txns.length });
  },
});
