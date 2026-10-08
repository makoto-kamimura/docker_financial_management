// 予算配分ルールへの科目の振り分けと、ルールの金額の科目への按分。I/O を持たない純関数。
//
// 振り分けは保存せず、その場で決める（追加した科目もすぐ配分に入り、キーワードを直せばすぐ効く）。
// 判定の順:
//   1. 手動の割り当て（allocation_account_assignments。ruleId = null は「配分に入れない」）
//   2. ルールのキーワード（科目名の部分一致）。複数のルールに当たったら、科目名の先頭に近い位置で
//      当たったものを採る（「娯楽/外食費」は「食費」より先頭の「娯楽」で娯楽・交際費へ）。
//      同じ位置なら長いキーワード（「自動車保険」は「自動車」より保険料）、それでも同じなら並び順
//   3. 受け皿のルール（fallbackCategory が科目の区分と同じもの）
//   4. どれにも当たらなければ未分類
// 1 科目は 1 ルールにだけ入る（二重に数えない）。対象は変動費・固定費・貯蓄の区分だけ。

// モバイルと共有する（lib/shared/shared-with-mobile.ts）ため、他のファイルを import しない。

/** 配分の対象の区分（受け皿にできる区分） */
export const ALLOCATION_TARGET_CATEGORIES = ["COGS", "EXPENSE", "PROFIT"] as const;
export type AllocationTargetCategory = (typeof ALLOCATION_TARGET_CATEGORIES)[number];

export type AssignableAccount = { id: number; code: string; name: string; category: string };

export type AssignRule = {
  id: number;
  keywords: string[];
  fallbackCategory: string | null;
  sortOrder: number;
};

export type ManualAssignment = { accountId: number; ruleId: number | null };

export type AssignmentSource = "manual" | "keyword" | "fallback" | "none";

export type Assignment = {
  accountId: number;
  /** 入るルール。null = どのルールにも入らない（手動で外した・未分類） */
  ruleId: number | null;
  source: AssignmentSource;
};

/** 配分の対象の区分か（収入・資産・負債などは対象外） */
export function isAllocationTarget(category: string): boolean {
  return (ALLOCATION_TARGET_CATEGORIES as readonly string[]).includes(category);
}

// 大文字小文字・全角半角・空白の違いを無視して比べる
export function normalizeForMatch(text: string): string {
  return text.normalize("NFKC").toUpperCase().replace(/\s+/g, "");
}

/** 手動の割り当てを除いて、科目が自動でどのルールに入るか */
export function autoAssign(
  account: Pick<AssignableAccount, "name" | "category">,
  rules: AssignRule[],
): { ruleId: number | null; source: Exclude<AssignmentSource, "manual"> } {
  const ordered = [...rules].sort((a, b) => a.sortOrder - b.sortOrder || a.id - b.id);
  const name = normalizeForMatch(account.name);
  let best: { ruleId: number; index: number; length: number } | null = null;
  for (const rule of ordered) {
    for (const raw of rule.keywords) {
      const keyword = normalizeForMatch(raw);
      if (keyword === "") continue;
      const index = name.indexOf(keyword);
      if (index < 0) continue;
      if (!best || index < best.index || (index === best.index && keyword.length > best.length)) {
        best = { ruleId: rule.id, index, length: keyword.length };
      }
    }
  }
  if (best) return { ruleId: best.ruleId, source: "keyword" };
  const fallback = ordered.find((r) => r.fallbackCategory === account.category);
  return fallback ? { ruleId: fallback.id, source: "fallback" } : { ruleId: null, source: "none" };
}

/** 配分の対象の科目すべてについて、入るルールを決める */
export function resolveAssignments(
  accounts: AssignableAccount[],
  rules: AssignRule[],
  manual: ManualAssignment[],
): Assignment[] {
  const ruleIds = new Set(rules.map((r) => r.id));
  const manualByAccount = new Map(manual.map((m) => [m.accountId, m.ruleId]));
  return accounts
    .filter((a) => isAllocationTarget(a.category))
    .map((a) => {
      if (manualByAccount.has(a.id)) {
        const ruleId = manualByAccount.get(a.id) ?? null;
        // 割り当て先のルールが消えていれば自動に戻す（通常は FK の CASCADE で行ごと消える）
        if (ruleId === null || ruleIds.has(ruleId)) {
          return { accountId: a.id, ruleId, source: "manual" as const };
        }
      }
      return { accountId: a.id, ...autoAssign(a, rules) };
    });
}

/** ルールごとのメンバー科目 ID（科目 ID の昇順） */
export function membersByRule(assignments: Assignment[]): Map<number, number[]> {
  const map = new Map<number, number[]>();
  for (const a of assignments) {
    if (a.ruleId === null) continue;
    map.set(a.ruleId, [...(map.get(a.ruleId) ?? []), a.accountId]);
  }
  for (const ids of map.values()) ids.sort((x, y) => x - y);
  return map;
}

/**
 * 金額を科目へ按分する（円単位）。weights（直近の実績など）の比率で分け、
 * 比率が付けられない（合計が 0 以下）ときは均等に分ける。端数は大きい順に 1 円ずつ配って合計を合わせる。
 */
export function splitByRatio(
  amount: number,
  accountIds: number[],
  weights: Map<number, number>,
): Map<number, number> {
  const result = new Map<number, number>();
  if (accountIds.length === 0) return result;
  const total = Math.round(amount);
  const w = accountIds.map((id) => Math.max(0, weights.get(id) ?? 0));
  const weightSum = w.reduce((s, v) => s + v, 0);
  const shares = accountIds.map((_, i) =>
    weightSum > 0 ? (total * w[i]) / weightSum : total / accountIds.length,
  );
  const floors = shares.map((v) => Math.floor(v));
  let rest = total - floors.reduce((s, v) => s + v, 0);
  const order = shares
    .map((v, i) => ({ i, frac: v - Math.floor(v) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (const { i } of order) {
    if (rest <= 0) break;
    floors[i] += 1;
    rest -= 1;
  }
  accountIds.forEach((id, i) => result.set(id, floors[i]));
  return result;
}

export type AllocationApplyPlan = {
  /** すでに予算が入っている科目（残す） */
  kept: { accountId: number; amount: number }[];
  /** 予算が未設定で、新しく入れる科目と金額 */
  added: { accountId: number; amount: number }[];
  /** ルールの金額 − 入っている予算（新しく入れる合計。0 以下なら何も入れない） */
  remaining: number;
};

/**
 * 「予算へ反映」の計画。すでに予算が入っている科目は残し、ルールの金額からその分を差し引いた
 * 残りを、予算が未設定の科目へ weights の比率で按分する。
 */
export function planAllocationApply(input: {
  amount: number;
  accountIds: number[];
  existingBudgets: Map<number, number>;
  weights: Map<number, number>;
}): AllocationApplyPlan {
  const kept = input.accountIds
    .filter((id) => input.existingBudgets.has(id))
    .map((id) => ({ accountId: id, amount: input.existingBudgets.get(id)! }));
  const unset = input.accountIds.filter((id) => !input.existingBudgets.has(id));
  const remaining = Math.round(input.amount) - kept.reduce((s, k) => s + k.amount, 0);
  if (remaining <= 0 || unset.length === 0) return { kept, added: [], remaining };
  const split = splitByRatio(remaining, unset, input.weights);
  return {
    kept,
    added: unset.map((id) => ({ accountId: id, amount: split.get(id) ?? 0 })),
    remaining,
  };
}
