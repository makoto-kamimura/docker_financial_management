// 収入合計（基準額）から予算配分ルールに基づく推奨額を算出する純関数。I/O を持たない。
//
// ローン返済などの自動反映（オーバーレイ）の扱い:
// - 科目がどれかのルールに入っているもの（ruleId あり。例: 家賃に連携した住宅ローン）は、そのルールの
//   目標額の一部として数える。基準額からは引かない（引いたうえで家賃の枠も取ると住居費を二重に数える）。
// - どのルールにも入っていないものは、配分の外の固定の支出として基準額から引く。

import { splitByRatio } from "@/lib/shared/allocation-assign";

export type AllocationRule = {
  id: number;
  key: string;
  label: string;
  group: string;
  minPercent: number;
  maxPercent: number | null;
  sortOrder: number;
};

export type AllocationOverlay = {
  accountId: number;
  amount: number;
  /** 科目が入っているルール（null・省略 = どのルールにも入っていない） */
  ruleId?: number | null;
};

export type AllocationItem = {
  rule: AllocationRule;
  min: number;
  max: number | null;
  /** ルールの目標額（自動反映の分を含む総額） */
  recommended: number;
  /** このルールに入っている自動反映（ローン返済など）の合計 */
  overlay: number;
};

export type Allocation503020 = { needs: number; wants: number; savings: number };

export type AllocationSuggestion = {
  basisAmount: number;
  available: number;
  items: AllocationItem[];
  /** 推奨額の合計（自動反映が目標額を超えるルールは自動反映の額で数える） */
  totalRecommended: number;
  /** 推奨額の合計が配分可能額を超えている場合に true */
  overRecommended: boolean;
  summary503020: Allocation503020;
};

// 銭単位で四捨五入して円単位にする。基準額・割合は非負のため Math.round で HALF_UP になる。
function roundYen(value: number): number {
  return Math.round(value);
}

function percentOf(base: number, percent: number): number {
  return roundYen((base * percent) / 100);
}

// group（固定費/生活費/その他）を 50/30/20 ルールの区分へ写像する。
function bucketOf(group: string): keyof Allocation503020 {
  if (group === "固定費") return "needs";
  if (group === "その他") return "savings";
  return "wants";
}

export function suggestAllocation(input: {
  basisAmount: number;
  overlays: AllocationOverlay[];
  rules: AllocationRule[];
}): AllocationSuggestion {
  const ruleIds = new Set(input.rules.map((r) => r.id));
  const overlayByRule = new Map<number, number>();
  let outsideTotal = 0;
  for (const o of input.overlays) {
    if (o.ruleId != null && ruleIds.has(o.ruleId)) {
      overlayByRule.set(o.ruleId, (overlayByRule.get(o.ruleId) ?? 0) + o.amount);
    } else {
      outsideTotal += o.amount;
    }
  }
  const available = Math.max(0, input.basisAmount - outsideTotal);

  const items: AllocationItem[] = input.rules.map((rule) => {
    const min = percentOf(available, rule.minPercent);
    const max = rule.maxPercent === null ? null : percentOf(available, rule.maxPercent);
    const recommendedPercent =
      rule.maxPercent === null ? rule.minPercent : (rule.minPercent + rule.maxPercent) / 2;
    const recommended = percentOf(available, recommendedPercent);
    return { rule, min, max, recommended, overlay: overlayByRule.get(rule.id) ?? 0 };
  });

  const planned = (i: AllocationItem) => Math.max(i.recommended, i.overlay);
  const totalRecommended = items.reduce((sum, i) => sum + planned(i), 0);

  const summary503020: Allocation503020 = { needs: 0, wants: 0, savings: 0 };
  for (const item of items) {
    const bucket = bucketOf(item.rule.group);
    summary503020[bucket] += planned(item);
  }

  return {
    basisAmount: input.basisAmount,
    available,
    items,
    totalRecommended,
    overRecommended: totalRecommended > available,
    summary503020,
  };
}

/**
 * ルールの目標額を科目へ分ける（予算の表の「適正」）。
 * 自動反映（ローン返済など）がある科目は、その額で埋まっているものとして、目標額の残りを
 * 自動反映の無い科目へ weights の比率で按分する（残りが 0 以下なら入れない）。
 * 自動反映のある科目しか無ければ、目標額をその科目へ自動反映の比率で分ける
 * （返済が目安より多いか少ないかを、予算と見比べられるようにする）。
 */
export function splitRuleTarget(input: {
  target: number;
  accountIds: number[];
  overlayByAccount: ReadonlyMap<number, number>;
  weights: Map<number, number>;
}): Map<number, number> {
  const overlaid = input.accountIds.filter((id) => (input.overlayByAccount.get(id) ?? 0) > 0);
  const others = input.accountIds.filter((id) => !overlaid.includes(id));
  if (others.length === 0) {
    const overlayWeights = new Map(overlaid.map((id) => [id, input.overlayByAccount.get(id)!]));
    return splitByRatio(input.target, overlaid, overlayWeights);
  }
  const overlayTotal = overlaid.reduce((s, id) => s + input.overlayByAccount.get(id)!, 0);
  const rest = input.target - overlayTotal;
  if (rest <= 0) return new Map();
  return splitByRatio(rest, others, input.weights);
}
