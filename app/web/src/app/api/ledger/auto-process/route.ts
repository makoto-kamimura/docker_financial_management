import { NextResponse } from "next/server";
import { withApi } from "@/lib/api-handler";
import { autoProcessEntries } from "@/lib/ledger-auto-process";
import { invalidateCache } from "@/lib/redis";

// POST /api/ledger/auto-process … 今ある明細のまとめての処理（editor 以上）。
// 未割り当ての明細に学習ルールで科目を付け、同じ日・同じ金額の送金と受金の組を振替・チャージにする
// （lib/ledger-auto-process.ts）。実績を確定済みの月の明細は変えない。
export const POST = withApi({
  role: "editor",
  handler: async ({ user, db, audit }) => {
    const result = await autoProcessEntries(db);
    await audit("ledger_auto_process", `tenant:${user.tenantId}`, { after: result });
    await invalidateCache(`assets:summary:${user.tenantId}:*`);
    return NextResponse.json({ data: result });
  },
});
