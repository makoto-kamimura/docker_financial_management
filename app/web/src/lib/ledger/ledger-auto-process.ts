import type { TenantDbClient } from "@/lib/server/tenant-db";
import { confirmedActualsPeriodIds } from "@/lib/budget/budget-lock";
import { applyAutoOffset } from "@/lib/ledger/auto-offset";
import { entryActualAmount, loadRuleClassifier, UNPAIRED } from "@/lib/ledger/ledger-entries";
import { loadSettlementLookup } from "@/lib/ledger/card-settlement";
import { PAIRED_CLEAR } from "@/lib/ledger/business-use";

// 今ある明細のまとめての処理（実績管理の「実績の確定」タブ）。
//   1. 学習ルールで明細（現金・銀行・カード）に科目を付ける（付けた明細はそのまま実績になる）
//      - 「まとめて自動処理」: 未割り当ての明細だけが対象。付いている科目は変えない
//      - 「科目を付け直す」（reset）: 科目の付いた明細も対象。ルールに当たればその科目に付け直し、
//        当たらなければ未割り当てに戻す（手で選んだ科目も外れる）
//      - ルールが事業利用を決めていれば、事業利用も付ける（付け直す）。決めていなければ事業利用は変えない
//      - 銀行の出金で、前にカード代金にした明細と同じ口座・同じ摘要のものは、科目ではなくカード代金の
//        引き落としにする（lib/ledger/card-settlement.ts。科目を付けると利用明細と二重に数えるため）
//   2. 同じ日・同じ金額の送金と受金の組が 1 組だけなら、振替・チャージの組にする（lib/ledger/auto-offset.ts）
// 振替・チャージの組の明細と、実績を確定済みの月の明細は変えない（確定済みの月は件数だけ返す）。

export type AutoProcessResult = {
  /** 学習ルールで科目を付けた（付け直した）件数 */
  categorized: number;
  /** 未割り当てに戻した件数（reset のときだけ） */
  cleared: number;
  /** カード代金の引き落としにした件数 */
  settled: number;
  /** 振替・チャージの組にした数 */
  offsetPairs: number;
  /** 実績を確定済みの月のため触らなかった明細の件数 */
  lockedSkipped: number;
};

export async function autoProcessEntries(
  db: TenantDbClient,
  options: { reset?: boolean } = {},
): Promise<AutoProcessResult> {
  const reset = options.reset ?? false;
  const [classify, settlementOf, entries] = await Promise.all([
    loadRuleClassifier(db),
    loadSettlementLookup(db),
    db.financialRecord.findMany({
      where: { kind: { not: null }, ...UNPAIRED, ...(reset ? {} : { accountId: null }) },
      select: {
        id: true,
        kind: true,
        bankAccountId: true,
        description: true,
        flow: true,
        periodId: true,
        accountId: true,
        businessUse: true,
        businessRatio: true,
      },
    }),
  ]);
  const locked = await confirmedActualsPeriodIds(
    db,
    entries.map((e) => e.periodId),
  );

  let categorized = 0;
  let cleared = 0;
  let settled = 0;
  for (const e of entries) {
    if (locked.has(e.periodId)) continue;
    const settleTo =
      e.kind === "BANK" ? settlementOf(e.bankAccountId, e.description, Number(e.flow)) : null;
    if (settleTo !== null) {
      await db.financialRecord.update({
        where: { id: e.id },
        data: { chargeToCardId: settleTo, ...PAIRED_CLEAR },
      });
      settled++;
      continue;
    }
    const category = classify(e.description ?? "", Number(e.flow));
    if (category) {
      const sameBusiness =
        !category.business ||
        (category.business.businessUse === e.businessUse &&
          category.business.businessRatio ===
            (e.businessRatio === null ? null : Number(e.businessRatio)));
      if (category.id === e.accountId && sameBusiness) continue;
      await db.financialRecord.update({
        where: { id: e.id },
        data: {
          accountId: category.id,
          amount: entryActualAmount(category.category, Number(e.flow)),
          ...category.business,
        },
      });
      categorized++;
    } else if (e.accountId !== null) {
      // reset のときだけここに来る（未割り当ての明細は accountId が null）
      await db.financialRecord.update({
        where: { id: e.id },
        data: { accountId: null, amount: 0 },
      });
      cleared++;
    }
  }

  const { pairs } = await applyAutoOffset(db);
  return {
    categorized,
    cleared,
    settled,
    offsetPairs: pairs,
    lockedSkipped: entries.filter((e) => locked.has(e.periodId)).length,
  };
}
