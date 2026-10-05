import type { TenantDbClient } from "@/lib/tenant-db";
import type { AllocationRule } from "@/lib/allocation";
import { ALLOCATION_TARGET_CATEGORIES } from "@/lib/default-allocation-rules";
import {
  membersByRule,
  resolveAssignments,
  type Assignment,
  type AssignRule,
} from "@/lib/allocation-assign";

// 予算配分の計算に要るもの（ルール・対象の科目・振り分け・按分の重みに使う実績）を読み込む。
// allocation-suggest / allocation-guide / allocation-rules / variance が共通で使う。

/** 按分の重みに使う実績の月数（対象月の前の 3 か月） */
export const WEIGHT_MONTHS = 3;

const ym = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;
const shift = (year: number, month: number, delta: number) => {
  const total = year * 12 + (month - 1) + delta;
  return { year: Math.floor(total / 12), month: (total % 12) + 1 };
};

export type AllocationAccount = {
  id: number;
  code: string;
  name: string;
  soleName: string | null;
  corporateName: string | null;
  category: string;
};

export async function loadAllocationContext(db: TenantDbClient, tenantId: number) {
  const [rules, accounts, manual] = await Promise.all([
    db.allocationRule.findMany({
      where: { tenantId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    }),
    db.account.findMany({
      where: { tenantId, category: { in: [...ALLOCATION_TARGET_CATEGORIES] } },
      select: {
        id: true,
        code: true,
        name: true,
        soleName: true,
        corporateName: true,
        category: true,
      },
      orderBy: { code: "asc" },
    }),
    db.allocationAccountAssignment.findMany({
      where: { tenantId },
      select: { accountId: true, ruleId: true },
    }),
  ]);

  const assignRules: AssignRule[] = rules.map((r) => ({
    id: r.id,
    keywords: r.keywords,
    fallbackCategory: r.fallbackCategory,
    sortOrder: r.sortOrder,
  }));
  const assignments: Assignment[] = resolveAssignments(accounts, assignRules, manual);
  const members = membersByRule(assignments);

  const ruleInputs: AllocationRule[] = rules.map((r) => ({
    id: r.id,
    key: r.key,
    label: r.label,
    group: r.group,
    minPercent: Number(r.minPercent),
    maxPercent: r.maxPercent === null ? null : Number(r.maxPercent),
    sortOrder: r.sortOrder,
  }));

  return {
    rules,
    ruleInputs,
    accounts: accounts as AllocationAccount[],
    assignments,
    /** ルール ID → メンバー科目 ID（昇順） */
    members,
  };
}

/**
 * 按分の重み（科目ごとの実績）を、対象月ごとに引けるようにする。
 * 対象月の前の WEIGHT_MONTHS か月の実績の合計を重みにする（マイナスは 0 として扱う）。
 * from〜to は重みを引きたい対象月の範囲（両端を含む）。
 */
export async function loadActualWeights(
  db: TenantDbClient,
  tenantId: number,
  accountIds: number[],
  from: { year: number; month: number },
  to: { year: number; month: number },
): Promise<(year: number, month: number) => Map<number, number>> {
  const start = shift(from.year, from.month, -WEIGHT_MONTHS);
  const end = shift(to.year, to.month, -1);
  const records =
    accountIds.length === 0
      ? []
      : await db.financialRecord.findMany({
          where: {
            tenantId,
            accountId: { in: accountIds },
            period: {
              OR: Array.from(
                { length: (end.year - start.year) * 12 + end.month - start.month + 1 },
                (_, i) => shift(start.year, start.month, i),
              ).map((p) => ({ fiscalYear: p.year, month: p.month })),
            },
          },
          select: {
            accountId: true,
            amount: true,
            period: { select: { fiscalYear: true, month: true } },
          },
        });

  const byMonth = new Map<string, Map<number, number>>();
  for (const r of records) {
    const key = ym(r.period.fiscalYear, r.period.month);
    const m = byMonth.get(key) ?? new Map<number, number>();
    m.set(r.accountId, (m.get(r.accountId) ?? 0) + Number(r.amount));
    byMonth.set(key, m);
  }

  return (year: number, month: number) => {
    const weights = new Map<number, number>();
    for (let i = 1; i <= WEIGHT_MONTHS; i++) {
      const p = shift(year, month, -i);
      for (const [accountId, amount] of byMonth.get(ym(p.year, p.month)) ?? []) {
        weights.set(accountId, (weights.get(accountId) ?? 0) + amount);
      }
    }
    for (const [id, v] of weights) if (v < 0) weights.set(id, 0);
    return weights;
  };
}

/**
 * 予算配分ルールの一覧（画面用）。ルールごとのキーワード・受け皿の区分・メンバー科目と、
 * どのルールにも入っていない科目（未分類・手動で外したもの）を返す。
 */
export async function loadAllocationRulesView(db: TenantDbClient, tenantId: number) {
  const { rules, accounts, assignments } = await loadAllocationContext(db, tenantId);
  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const memberView = (a: Assignment) => ({ ...accountById.get(a.accountId)!, source: a.source });

  return {
    rules: rules.map((r) => ({
      id: r.id,
      key: r.key,
      label: r.label,
      group: r.group,
      minPercent: Number(r.minPercent),
      maxPercent: r.maxPercent === null ? null : Number(r.maxPercent),
      note: r.note,
      keywords: r.keywords,
      fallbackCategory: r.fallbackCategory,
      sortOrder: r.sortOrder,
      accounts: assignments.filter((a) => a.ruleId === r.id).map(memberView),
    })),
    /** どのルールにも入っていない科目（source: none = 未分類 / manual = 手動で外した） */
    unassigned: assignments.filter((a) => a.ruleId === null).map(memberView),
  };
}
