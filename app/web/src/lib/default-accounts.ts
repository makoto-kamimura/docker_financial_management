import type { Prisma, AccountCategory } from "@prisma/client";
import { ACCOUNT_DISPLAY_NAMES } from "../../prisma/account-display-names";

/**
 * 家庭モード 勘定科目マスタ（既定の勘定科目一覧）
 * 参照: docs/home-mode-accounts.md
 *
 * コード体系: H-XXXX（H-prefix + 4桁）
 * - H-1xxx: 収入（REVENUE）
 * - H-2xxx: 変動生活費（COGS）
 * - H-3xxx: 固定費・経費（EXPENSE）
 * - H-4xxx: 負債・ローン（LIABILITY）
 * - H-5xxx: 経過勘定（ASSET / LIABILITY）
 *
 * 新規テナント作成時（`POST /api/admin/users` の newTenant / `POST /api/tenants`）に
 * 自動でこの一覧を登録する。`prisma/seed-home-accounts.ts` もこのデータを使用する。
 */
export const HOME_ACCOUNTS_SEED = [
  // ── 収入（REVENUE）H-1001〜H-1016 ──────────────────────────────────────
  { code: "H-1001", name: "給与", category: "REVENUE" },
  { code: "H-1002", name: "賞与", category: "REVENUE" },
  { code: "H-1003", name: "株式配当", category: "REVENUE" },
  { code: "H-1004", name: "投資信託分配金", category: "REVENUE" },
  { code: "H-1005", name: "利子収入", category: "REVENUE" },
  { code: "H-1006", name: "不動産所得", category: "REVENUE" },
  { code: "H-1007", name: "事業所得", category: "REVENUE" },
  { code: "H-1008", name: "副業収入", category: "REVENUE" },
  { code: "H-1009", name: "年金収入", category: "REVENUE" },
  { code: "H-1010", name: "失業給付・育児休業給付", category: "REVENUE" },
  { code: "H-1011", name: "児童手当・各種補助金", category: "REVENUE" },
  { code: "H-1012", name: "保険割戻金", category: "REVENUE" },
  { code: "H-1013", name: "フリマ・ネット売却収入", category: "REVENUE" },
  { code: "H-1014", name: "仮想通貨売却益", category: "REVENUE" },
  { code: "H-1015", name: "ポイント・キャッシュバック", category: "REVENUE" },
  { code: "H-1016", name: "仕送り収入", category: "REVENUE" },

  // ── 変動生活費（COGS）H-2001〜H-2017 ────────────────────────────────────
  { code: "H-2001", name: "食費", category: "COGS" },
  { code: "H-2002", name: "飲料費", category: "COGS" },
  { code: "H-2003", name: "健康食費", category: "COGS" },
  { code: "H-2004", name: "日用品/消耗品", category: "COGS" },
  { code: "H-2005", name: "医療費", category: "COGS" },
  { code: "H-2006", name: "医薬品費", category: "COGS" },
  { code: "H-2007", name: "被服費", category: "COGS" },
  { code: "H-2008", name: "美容・化粧品費", category: "COGS" },
  { code: "H-2009", name: "教育費", category: "COGS" },
  { code: "H-2010", name: "子育て・育児費", category: "COGS" },
  { code: "H-2011", name: "書籍・雑誌費", category: "COGS" },
  { code: "H-2012", name: "ペットの飲食費", category: "COGS" },
  { code: "H-2013", name: "ペットの医療費", category: "COGS" },
  { code: "H-2014", name: "ペットの日用品/消耗品", category: "COGS" },
  { code: "H-2015", name: "交際費・贈答費", category: "COGS" },
  { code: "H-2016", name: "冠婚葬祭費", category: "COGS" },
  { code: "H-2017", name: "趣味用品費", category: "COGS" },

  // ── 固定費・経費（EXPENSE）H-3001〜H-3034 ────────────────────────────────
  { code: "H-3001", name: "電気代", category: "EXPENSE" },
  { code: "H-3002", name: "ガス代", category: "EXPENSE" },
  { code: "H-3003", name: "水道代", category: "EXPENSE" },
  { code: "H-3004", name: "固定ネット回線", category: "EXPENSE" },
  { code: "H-3005", name: "モバイルネット回線", category: "EXPENSE" },
  { code: "H-3006", name: "通勤費", category: "EXPENSE" },
  { code: "H-3007", name: "その他交通費", category: "EXPENSE" },
  { code: "H-3008", name: "娯楽/外食費", category: "EXPENSE" },
  { code: "H-3009", name: "社会保険", category: "EXPENSE" },
  { code: "H-3010", name: "医療保険", category: "EXPENSE" },
  { code: "H-3011", name: "自動車保険", category: "EXPENSE" },
  { code: "H-3012", name: "自動車税", category: "EXPENSE" },
  { code: "H-3013", name: "固定資産税", category: "EXPENSE" },
  { code: "H-3014", name: "住民税", category: "EXPENSE" },
  { code: "H-3015", name: "事業経費", category: "EXPENSE" },
  { code: "H-3016", name: "家具家電設備費", category: "EXPENSE" },
  { code: "H-3017", name: "理容/美容費", category: "EXPENSE" },
  { code: "H-3018", name: "家賃", category: "EXPENSE" },
  { code: "H-3019", name: "管理費・修繕積立金", category: "EXPENSE" },
  { code: "H-3020", name: "住宅修繕費", category: "EXPENSE" },
  { code: "H-3021", name: "ガソリン代", category: "EXPENSE" },
  { code: "H-3022", name: "駐車場代", category: "EXPENSE" },
  { code: "H-3023", name: "車検・整備費", category: "EXPENSE" },
  { code: "H-3024", name: "高速道路料金", category: "EXPENSE" },
  { code: "H-3025", name: "旅行費", category: "EXPENSE" },
  { code: "H-3026", name: "習い事・カルチャー費", category: "EXPENSE" },
  { code: "H-3027", name: "生命保険", category: "EXPENSE" },
  { code: "H-3028", name: "火災保険・地震保険", category: "EXPENSE" },
  { code: "H-3029", name: "学資保険", category: "EXPENSE" },
  { code: "H-3030", name: "所得税", category: "EXPENSE" },
  { code: "H-3031", name: "新聞・放送受信料", category: "EXPENSE" },
  { code: "H-3032", name: "サブスクリプション費", category: "EXPENSE" },
  { code: "H-3033", name: "寄付・募金", category: "EXPENSE" },
  { code: "H-3034", name: "仕送り支出", category: "EXPENSE" },

  // ── 負債・ローン（LIABILITY）H-4001〜H-4005 ──────────────────────────────
  { code: "H-4001", name: "住宅ローン", category: "LIABILITY" },
  { code: "H-4002", name: "自動車ローン", category: "LIABILITY" },
  { code: "H-4003", name: "奨学金", category: "LIABILITY" },
  { code: "H-4004", name: "カードローン・消費者金融", category: "LIABILITY" },
  { code: "H-4005", name: "その他借入金", category: "LIABILITY" },

  // ── 経過勘定（ASSET / LIABILITY）H-5001〜H-5004 ─────────────────────────
  { code: "H-5001", name: "前払費用", category: "ASSET" },
  { code: "H-5002", name: "未払費用", category: "LIABILITY" },
  { code: "H-5003", name: "未収収益", category: "ASSET" },
  { code: "H-5004", name: "前受収益", category: "LIABILITY" },
] as const satisfies readonly { code: string; name: string; category: AccountCategory }[];

/**
 * 指定テナントに家庭モードの既定勘定科目一式を登録する。
 * 既に同じコードの科目が存在する場合は何もしない（ユーザーの編集を上書きしない）。
 * `db` には通常の PrismaClient、または `$transaction` 内の TransactionClient を渡せる。
 */
export async function seedDefaultAccountsForTenant(
  db: Prisma.TransactionClient,
  tenantId: number,
): Promise<number> {
  let created = 0;
  for (const acc of HOME_ACCOUNTS_SEED) {
    const names = ACCOUNT_DISPLAY_NAMES[acc.code];
    const existing = await db.account.findUnique({
      where: { tenantId_code: { tenantId, code: acc.code } },
    });
    if (existing) continue;
    await db.account.create({
      data: {
        tenantId,
        code: acc.code,
        name: acc.name,
        category: acc.category,
        soleName: names?.sole ?? acc.name,
        corporateName: names?.corporate ?? acc.name,
      },
    });
    created++;
  }
  return created;
}
