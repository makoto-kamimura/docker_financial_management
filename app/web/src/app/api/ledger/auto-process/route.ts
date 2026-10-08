import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { autoProcessEntries } from "@/lib/ledger-auto-process";
import { invalidateCache } from "@/lib/redis";

// POST /api/ledger/auto-process … 今ある明細のまとめての処理（editor 以上。lib/ledger-auto-process.ts）。
//   ?reset=0（既定）: 「まとめて自動処理」。未割り当ての明細に学習ルールで科目を付ける
//   ?reset=1: 「科目を付け直す」。科目の付いた明細も学習ルールで付け直し、当たらなければ未割り当てに戻す
// どちらも、そのあと同じ日・同じ金額の送金と受金の組を振替・チャージにする。確定済みの月の明細は変えない。
export const POST = withApi({
  role: "editor",
  querySchema: z.object({ reset: z.enum(["0", "1"]).default("0") }),
  handler: async ({ user, db, query, audit }) => {
    const reset = query.reset === "1";
    const result = await autoProcessEntries(db, { reset });
    await audit(reset ? "ledger_recategorize" : "ledger_auto_process", `tenant:${user.tenantId}`, {
      after: result,
    });
    await invalidateCache(`assets:summary:${user.tenantId}:*`);
    return NextResponse.json({ data: result });
  },
});
