import type { Prisma } from "@prisma/client";

/**
 * 予算配分ルールの既定値（FP 推奨・手取り収入ベース）。
 * 旧実装のモバイル内定数（app/mobile/src/api.ts の DEFAULT_ALLOCATION）を
 * サーバー側マスタへ昇格させたもの。テナント作成時に自動投入する。
 *
 * accountCode は家庭モード既定科目（HOME_ACCOUNTS_SEED の H-xxxx）への紐付け。
 * 複数科目にまたがる項目（水道・光熱費など）は null（未紐付け）とする。
 */
export const ALLOCATION_GROUPS = ["固定費", "生活費", "その他"] as const;

export type AllocationGroup = (typeof ALLOCATION_GROUPS)[number];

export type AllocationRuleSeed = {
  key: string;
  label: string;
  group: AllocationGroup;
  minPercent: number;
  /** null = 上限なし（「○％以上」の目安） */
  maxPercent: number | null;
  note?: string;
  /** 対応する支払項目科目の家庭モード科目コード（null = 未紐付け） */
  accountCode: string | null;
};

export const DEFAULT_ALLOCATION_RULES: readonly AllocationRuleSeed[] = [
  // ── 固定費 ──────────────────────────────────────────────────────────
  // prettier-ignore
  { key: "rent",          label: "家賃・住宅ローン",                    group: "固定費", minPercent: 20, maxPercent: 30, note: "理想は25%以内", accountCode: "H-3018" },
  // prettier-ignore
  { key: "utilities",     label: "水道・光熱費",                        group: "固定費", minPercent: 5,  maxPercent: 8,  accountCode: null },
  // prettier-ignore
  { key: "communication", label: "通信費（スマホ・インターネット）",     group: "固定費", minPercent: 3,  maxPercent: 6,  accountCode: null },
  // prettier-ignore
  { key: "insurance",     label: "保険料",                              group: "固定費", minPercent: 5,  maxPercent: 10, accountCode: null },
  // ── 生活費 ──────────────────────────────────────────────────────────
  // prettier-ignore
  { key: "food",          label: "食費",                                group: "生活費", minPercent: 15, maxPercent: 20, accountCode: "H-2001" },
  // prettier-ignore
  { key: "car",           label: "車関連（ガソリン・保険・駐車場など）", group: "生活費", minPercent: 5,  maxPercent: 15, accountCode: null },
  // prettier-ignore
  { key: "daily",         label: "日用品・衣服",                        group: "生活費", minPercent: 3,  maxPercent: 5,  accountCode: "H-2004" },
  // prettier-ignore
  { key: "education",     label: "教育費（子どもがいる場合）",          group: "生活費", minPercent: 5,  maxPercent: 15, accountCode: "H-2009" },
  // ── その他 ──────────────────────────────────────────────────────────
  // prettier-ignore
  { key: "leisure",       label: "娯楽・交際費",                        group: "その他", minPercent: 5,  maxPercent: 10, accountCode: "H-3008" },
  // prettier-ignore
  { key: "savings",       label: "貯蓄・投資",                          group: "その他", minPercent: 20, maxPercent: null, note: "最低10%は確保", accountCode: null },
];

/**
 * 指定テナントに既定の予算配分ルール一式を登録する。
 * 既に同じ key のルールが存在する場合は何もしない（ユーザーの編集を上書きしない）。
 * 科目コードが解決できない場合（別体系の科目を使うテナント等）は未紐付けで登録する。
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

    let accountId: number | null = null;
    if (rule.accountCode) {
      const account = await db.account.findUnique({
        where: { tenantId_code: { tenantId, code: rule.accountCode } },
      });
      accountId = account?.id ?? null;
    }

    await db.allocationRule.create({
      data: {
        tenantId,
        key: rule.key,
        label: rule.label,
        group: rule.group,
        minPercent: rule.minPercent,
        maxPercent: rule.maxPercent,
        note: rule.note ?? null,
        accountId,
        sortOrder: index,
      },
    });
    created++;
  }
  return created;
}
