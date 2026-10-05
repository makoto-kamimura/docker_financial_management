import type { Prisma } from "@prisma/client";
import type { AllocationTargetCategory } from "./allocation-assign";

/**
 * 予算配分ルールの既定値（FP 推奨・手取り収入ベース）。
 * 旧実装のモバイル内定数（app/mobile/src/api.ts の DEFAULT_ALLOCATION）を
 * サーバー側マスタへ昇格させたもの。テナント作成時に自動投入する。
 *
 * 科目はルールに直接結び付けず、科目名のキーワード（keywords）と受け皿の区分
 * （fallbackCategory）でその場で振り分ける（lib/allocation-assign.ts）。追加した科目も
 * 自動でどれかのルールに入る。値はマイグレーション 20261006120000_allocation_auto_assign と同じ。
 */
export const ALLOCATION_GROUPS = ["固定費", "生活費", "その他"] as const;

export type AllocationGroup = (typeof ALLOCATION_GROUPS)[number];

export { ALLOCATION_TARGET_CATEGORIES } from "./allocation-assign";

export type AllocationRuleSeed = {
  key: string;
  label: string;
  group: AllocationGroup;
  minPercent: number;
  /** null = 上限なし（「○％以上」の目安） */
  maxPercent: number | null;
  note?: string;
  /** 科目名にこのどれかを含む科目をこのルールに入れる */
  keywords: string[];
  /** キーワードに当たらなかったこの区分の科目を受け取る（受け皿） */
  fallbackCategory?: AllocationTargetCategory;
};

// 社会保険・税は給与から引かれる分なので、保険料のキーワードには入れない（その他の固定費に入る）
export const DEFAULT_ALLOCATION_RULES: readonly AllocationRuleSeed[] = [
  // ── 固定費 ──────────────────────────────────────────────────────────
  // prettier-ignore
  { key: "rent",          label: "家賃・住宅ローン",                    group: "固定費", minPercent: 20, maxPercent: 30, note: "理想は25%以内", keywords: ["家賃", "住宅ローン", "管理費", "修繕積立", "住宅修繕"] },
  // prettier-ignore
  { key: "utilities",     label: "水道・光熱費",                        group: "固定費", minPercent: 5,  maxPercent: 8,  keywords: ["電気", "ガス", "水道", "光熱"] },
  // prettier-ignore
  { key: "communication", label: "通信費（スマホ・インターネット）",     group: "固定費", minPercent: 3,  maxPercent: 6,  keywords: ["回線", "通信", "スマホ", "携帯", "インターネット"] },
  // prettier-ignore
  { key: "insurance",     label: "保険料",                              group: "固定費", minPercent: 5,  maxPercent: 10, keywords: ["生命保険", "医療保険", "がん保険", "火災保険", "地震保険", "学資保険", "自動車保険", "ペット保険", "傷害保険", "個人年金"] },
  // ── 生活費 ──────────────────────────────────────────────────────────
  // prettier-ignore
  { key: "food",          label: "食費",                                group: "生活費", minPercent: 15, maxPercent: 20, keywords: ["食費", "飲料", "食料"] },
  // prettier-ignore
  { key: "car",           label: "車関連（ガソリン・保険・駐車場など）", group: "生活費", minPercent: 5,  maxPercent: 15, keywords: ["ガソリン", "駐車", "車検", "高速道路", "自動車", "車"] },
  // prettier-ignore
  { key: "daily",         label: "日用品・衣服",                        group: "生活費", minPercent: 3,  maxPercent: 5,  keywords: ["日用品", "消耗品", "被服", "衣服", "美容", "化粧"] },
  // prettier-ignore
  { key: "education",     label: "教育費（子どもがいる場合）",          group: "生活費", minPercent: 5,  maxPercent: 15, keywords: ["教育", "学費", "習い事", "書籍", "子育て", "育児"] },
  // ── その他 ──────────────────────────────────────────────────────────
  // prettier-ignore
  { key: "leisure",       label: "娯楽・交際費",                        group: "その他", minPercent: 5,  maxPercent: 10, keywords: ["娯楽", "外食", "交際", "趣味", "旅行", "冠婚葬祭", "贈答"] },
  // prettier-ignore
  { key: "savings",       label: "貯蓄・投資",                          group: "その他", minPercent: 20, maxPercent: null, note: "最低10%は確保", keywords: ["貯蓄", "積立", "投資", "NISA", "iDeCo", "預金"] },
  // ── 受け皿（どのキーワードにも当たらない科目） ───────────────────────────────
  // prettier-ignore
  { key: "other_fixed",   label: "その他の固定費",                      group: "固定費", minPercent: 0,  maxPercent: 5,  note: "どのキーワードにも当たらない固定費の科目が入る", keywords: [], fallbackCategory: "EXPENSE" },
  // prettier-ignore
  { key: "other_living",  label: "その他の生活費",                      group: "生活費", minPercent: 0,  maxPercent: 5,  note: "どのキーワードにも当たらない変動費の科目が入る", keywords: [], fallbackCategory: "COGS" },
];

/**
 * 指定テナントに既定の予算配分ルール一式を登録する。
 * 既に同じ key のルールが存在する場合は何もしない（ユーザーの編集を上書きしない）。
 * `db` には通常の PrismaClient、または `$transaction` 内の TransactionClient を渡せる。
 */
export async function seedDefaultAllocationRulesForTenant(
  db: Prisma.TransactionClient,
  tenantId: number,
): Promise<number> {
  let created = 0;
  for (const [index, rule] of DEFAULT_ALLOCATION_RULES.entries()) {
    const existing = await db.allocationRule.findUnique({
      where: { tenantId_key: { tenantId, key: rule.key } },
    });
    if (existing) continue;

    await db.allocationRule.create({
      data: {
        tenantId,
        key: rule.key,
        label: rule.label,
        group: rule.group,
        minPercent: rule.minPercent,
        maxPercent: rule.maxPercent,
        note: rule.note ?? null,
        keywords: rule.keywords,
        fallbackCategory: rule.fallbackCategory ?? null,
        sortOrder: index,
      },
    });
    created++;
  }
  return created;
}
