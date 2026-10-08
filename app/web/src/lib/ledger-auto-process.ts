import type { TenantDbClient } from "@/lib/tenant-db";
import { confirmedActualsPeriodIds } from "@/lib/budget-lock";
import { applyAutoOffset } from "@/lib/auto-offset";
import { entryActualAmount, loadRuleClassifier, UNPAIRED } from "@/lib/ledger-entries";

// 今ある明細のまとめての処理（実績管理の「実績の確定」タブの「まとめて自動処理」）。
//   1. 未割り当ての明細（現金・銀行・カード）に、学習ルールで科目を付ける（付けた明細はそのまま実績になる）
//   2. 同じ日・同じ金額の送金と受金の組が 1 組だけなら、振替・チャージの組にする（lib/auto-offset.ts）
// 実績を確定済みの月の明細は変えない（件数だけ返す）。

export type AutoProcessResult = {
  /** 学習ルールで科目を付けた件数 */
  categorized: number;
  /** 振替・チャージの組にした数 */
  offsetPairs: number;
  /** 実績を確定済みの月のため触らなかった未割り当ての明細の件数 */
  lockedSkipped: number;
};

export async function autoProcessEntries(db: TenantDbClient): Promise<AutoProcessResult> {
  const [classify, unassigned] = await Promise.all([
    loadRuleClassifier(db),
    db.financialRecord.findMany({
      where: { kind: { not: null }, accountId: null, ...UNPAIRED },
      select: { id: true, description: true, flow: true, periodId: true },
    }),
  ]);
  const locked = await confirmedActualsPeriodIds(
    db,
    unassigned.map((e) => e.periodId),
  );

  let categorized = 0;
  for (const e of unassigned) {
    if (locked.has(e.periodId)) continue;
    const category = classify(e.description ?? "");
    if (!category) continue;
    await db.financialRecord.update({
      where: { id: e.id },
      data: {
        accountId: category.id,
        amount: entryActualAmount(category.category, Number(e.flow)),
      },
    });
    categorized++;
  }

  const { pairs } = await applyAutoOffset(db);
  return {
    categorized,
    offsetPairs: pairs,
    lockedSkipped: unassigned.filter((e) => locked.has(e.periodId)).length,
  };
}
