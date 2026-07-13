// 収入合計（基準額）から予算配分ルールに基づく推奨額を算出する純関数。I/O を持たない。

export type AllocationRule = {
  id: number;
  key: string;
  label: string;
  group: string;
  minPercent: number;
  maxPercent: number | null;
  accountId: number | null;
  sortOrder: number;
};

export type AllocationOverlay = { accountId: number; amount: number };

export type AllocationItem = {
  rule: AllocationRule;
  min: number;
  max: number | null;
  recommended: number;
};

export type Allocation503020 = { needs: number; wants: number; savings: number };

export type AllocationSuggestion = {
  basisAmount: number;
  available: number;
  items: AllocationItem[];
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
  const overlayTotal = input.overlays.reduce((sum, o) => sum + o.amount, 0);
  const available = Math.max(0, input.basisAmount - overlayTotal);

  const items: AllocationItem[] = input.rules.map((rule) => {
    const min = percentOf(available, rule.minPercent);
    const max = rule.maxPercent === null ? null : percentOf(available, rule.maxPercent);
    const recommendedPercent =
      rule.maxPercent === null ? rule.minPercent : (rule.minPercent + rule.maxPercent) / 2;
    const recommended = percentOf(available, recommendedPercent);
    return { rule, min, max, recommended };
  });

  const totalRecommended = items.reduce((sum, i) => sum + i.recommended, 0);

  const summary503020: Allocation503020 = { needs: 0, wants: 0, savings: 0 };
  for (const item of items) {
    const bucket = bucketOf(item.rule.group);
    summary503020[bucket] += item.recommended;
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
