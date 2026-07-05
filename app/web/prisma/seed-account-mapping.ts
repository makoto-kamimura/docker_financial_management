/**
 * 勘定科目変換マスタ seed（AccountMappingRule）
 * 参照: docs/account-master-mapping.md / docs/home-to-corporate-account-mapping.md
 *
 * matchType: TABLE（信頼度1.0 = 確定変換）
 * isConvertible: false → ❌ 変換不可科目
 * corporateCode: null → 法人に対応科目なし
 *
 * 法人科目コード（corporateCode）は seed-business-accounts.ts で定義されているコードに準拠。
 * 統合先が複数の場合は最も一般的な科目を primary とし、notes に代替候補を記載。
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

type MappingRule = {
  homeCode: string;
  corporateCode: string | null;
  isConvertible: boolean;
  notes?: string;
};

// ── 収入（REVENUE）────────────────────────────────────────────────────────
const REVENUE_RULES: MappingRule[] = [
  {
    homeCode: "H-1001",
    corporateCode: null, // 役員報酬は別途設定が必要
    isConvertible: true,
    notes: "法人では支払側として費用計上。役員報酬または給与手当へ変換（↩️向き逆転）",
  },
  {
    homeCode: "H-1002",
    corporateCode: null,
    isConvertible: true,
    notes: "法人では支払側として費用計上（↩️向き逆転）。役員賞与は事前確定届出給与として処理",
  },
  {
    homeCode: "H-1003",
    corporateCode: "4000", // 雑収入（受取配当金は独立科目として設定推奨）
    isConvertible: true,
    notes: "受取配当金として営業外収益に計上。受取配当等の益金不算入制度に注意",
  },
  {
    homeCode: "H-1004",
    corporateCode: "4000",
    isConvertible: true,
    notes: "普通分配金→受取配当金、特別分配金→元本払戻で処理が異なる",
  },
  {
    homeCode: "H-1005",
    corporateCode: "4000",
    isConvertible: true,
    notes: "受取利息として営業外収益に計上。源泉税の取扱いに注意",
  },
  {
    homeCode: "H-1006",
    corporateCode: "4000",
    isConvertible: true,
    notes: "不動産賃貸収入として計上。本業/副業かで営業収益・営業外収益に分かれる",
  },
  {
    homeCode: "H-1007",
    corporateCode: "4000", // 売上高
    isConvertible: true,
    notes: "売上高として計上。法人の主たる収益科目に対応",
  },
  {
    homeCode: "H-1008",
    corporateCode: "4000",
    isConvertible: true,
    notes: "売上高または雑収入。事業継続性・規模により科目が変わる",
  },
  {
    homeCode: "H-1009",
    corporateCode: null,
    isConvertible: false,
    notes: "法人に直接対応する科目なし。個人の雑所得として分離",
  },
  {
    homeCode: "H-1010",
    corporateCode: null,
    isConvertible: false,
    notes: "個人への給付のため法人会計には計上しない",
  },
  {
    homeCode: "H-1011",
    corporateCode: "4000",
    isConvertible: true,
    notes: "法人が受け取る補助金・助成金は益金算入が原則。雑収入または補助金収入として計上",
  },
  {
    homeCode: "H-1012",
    corporateCode: "4000",
    isConvertible: true,
    notes: "雑収入として計上。積立型保険との相殺処理が必要な場合あり",
  },
  {
    homeCode: "H-1013",
    corporateCode: "4000",
    isConvertible: true,
    notes: "事業として継続する場合は売上高、単発は雑収入。消費税課税要否の確認が必要",
  },
  {
    homeCode: "H-1014",
    corporateCode: "4000",
    isConvertible: true,
    notes: "法人税の課税対象。期末評価（時価法）にも注意",
  },
  {
    homeCode: "H-1015",
    corporateCode: "4000",
    isConvertible: true,
    notes: "雑収入として益金算入。課税タイミングに注意",
  },
  {
    homeCode: "H-1016",
    corporateCode: null,
    isConvertible: false,
    notes: "個人間の資金移動のため法人会計には計上しない",
  },
];

// ── 変動生活費（COGS）────────────────────────────────────────────────────
const COGS_RULES: MappingRule[] = [
  {
    homeCode: "H-2001",
    corporateCode: "7400", // 会議費（最も一般的な用途）
    isConvertible: true,
    notes: "用途により: 社内会議→会議費(7400)、従業員向け→福利厚生費(7800)、接待→接待交際費(8000)。個人的食費は不可",
  },
  {
    homeCode: "H-2002",
    corporateCode: "7400",
    isConvertible: true,
    notes: "社内飲料→福利厚生費(7800)、客先提供→会議費(7400)または接待交際費(8000)",
  },
  {
    homeCode: "H-2003",
    corporateCode: "7800", // 福利厚生費
    isConvertible: true,
    notes: "全従業員に平等に提供される場合のみ福利厚生費として認定。個人的購入は不可",
  },
  {
    homeCode: "H-2004",
    corporateCode: "7100", // 消耗品費
    isConvertible: true,
    notes: "1点10万円未満が原則。以上は固定資産計上を検討",
  },
  {
    homeCode: "H-2005",
    corporateCode: "7800",
    isConvertible: true,
    notes: "法定健診・会社負担の医療費のみ福利厚生費として認定。個人的医療費は不可",
  },
  {
    homeCode: "H-2006",
    corporateCode: "7800",
    isConvertible: true,
    notes: "全従業員向け常備薬等のみ福利厚生費。個人的購入は不可",
  },
  {
    homeCode: "H-2007",
    corporateCode: "7100",
    isConvertible: true,
    notes: "制服・ユニフォーム・作業着に限り消耗品費として計上可。私服は経費不可",
  },
  {
    homeCode: "H-2008",
    corporateCode: null,
    isConvertible: false,
    notes: "個人的支出とみなされ法人経費として認定不可",
  },
  {
    homeCode: "H-2009",
    corporateCode: "7800", // 福利厚生費（研修費は独立科目として設定推奨）
    isConvertible: true,
    notes: "業務に直接関連するスキルアップ・資格取得のみ研修費として計上可",
  },
  {
    homeCode: "H-2010",
    corporateCode: "7800",
    isConvertible: true,
    notes: "事業所内保育所の費用は福利厚生費として計上可。個人的育児費は不可",
  },
  {
    homeCode: "H-2011",
    corporateCode: "7100", // 消耗品費（新聞図書費は独立科目として設定推奨）
    isConvertible: true,
    notes: "業務関連書籍・専門誌のみ算入可",
  },
  {
    homeCode: "H-2012",
    corporateCode: null,
    isConvertible: false,
    notes: "ペット関連事業以外は法人経費として認定不可",
  },
  {
    homeCode: "H-2013",
    corporateCode: null,
    isConvertible: false,
    notes: "同上",
  },
  {
    homeCode: "H-2014",
    corporateCode: null,
    isConvertible: false,
    notes: "同上",
  },
  {
    homeCode: "H-2015",
    corporateCode: "8000", // 接待交際費
    isConvertible: true,
    notes: "取引先・業務関係者向けのみ。損金算入上限（中小法人: 年800万円 or 飲食費50%）あり",
  },
  {
    homeCode: "H-2016",
    corporateCode: "8000",
    isConvertible: true,
    notes: "取引先関連の慶弔費のみ算入可。個人的な冠婚葬祭費は不可",
  },
  {
    homeCode: "H-2017",
    corporateCode: null,
    isConvertible: false,
    notes: "個人的支出として認定不可。業務上必要な道具は消耗品費(7100)で別途計上",
  },
];

// ── 固定費・経費（EXPENSE）───────────────────────────────────────────────
const EXPENSE_RULES: MappingRule[] = [
  // 公共料金・通信費（🔄 統合）
  {
    homeCode: "H-3001",
    corporateCode: "7200", // 水道光熱費
    isConvertible: true,
    notes: "電気・ガス・水道を1科目に統合。自宅兼事務所は事業使用割合で按分",
  },
  {
    homeCode: "H-3002",
    corporateCode: "7200",
    isConvertible: true,
    notes: "同上",
  },
  {
    homeCode: "H-3003",
    corporateCode: "7200",
    isConvertible: true,
    notes: "同上",
  },
  {
    homeCode: "H-3004",
    corporateCode: "7000", // 通信費
    isConvertible: true,
    notes: "固定・モバイルを1科目に統合。自宅兼事務所は事業使用割合で按分",
  },
  {
    homeCode: "H-3005",
    corporateCode: "7000",
    isConvertible: true,
    notes: "同上。私用兼業の場合は事業使用割合（接続数・時間等）で按分必要",
  },
  // 住居費
  {
    homeCode: "H-3018",
    corporateCode: "7500", // 地代家賃
    isConvertible: true,
    notes: "自宅兼事務所は事業専用面積割合で按分。按分根拠資料の保存が必要",
  },
  {
    homeCode: "H-3019",
    corporateCode: "7500",
    isConvertible: true,
    notes: "管理費は地代家賃として計上。修繕積立金は支払時費用計上か積立金処理か要確認",
  },
  {
    homeCode: "H-3020",
    corporateCode: "7100", // 消耗品費（修繕費は独立科目として設定推奨）
    isConvertible: true,
    notes: "事業按分分のみ算入可。修繕費または資本的支出かの判定も必要",
  },
  // 交通費
  {
    homeCode: "H-3006",
    corporateCode: "7300", // 車両費（旅費交通費として独立科目設定推奨）
    isConvertible: true,
    notes: "通勤費・出張費を旅費交通費として1科目に統合",
  },
  {
    homeCode: "H-3007",
    corporateCode: "7300",
    isConvertible: true,
    notes: "事業関連の移動のみ算入可。出張旅費規程に基づく精算体制の整備が推奨",
  },
  {
    homeCode: "H-3021",
    corporateCode: "7300", // 車両費
    isConvertible: true,
    notes: "事業使用割合（走行距離・日数）で按分。走行記録の保存が必要",
  },
  {
    homeCode: "H-3022",
    corporateCode: "7300",
    isConvertible: true,
    notes: "事業関連分のみ算入可",
  },
  {
    homeCode: "H-3023",
    corporateCode: "7300",
    isConvertible: true,
    notes: "事業使用分のみ算入可。事業按分で計算",
  },
  {
    homeCode: "H-3024",
    corporateCode: "7300",
    isConvertible: true,
    notes: "事業関連の移動のみ算入可",
  },
  // 娯楽・外食・レジャー
  {
    homeCode: "H-3008",
    corporateCode: "8000", // 接待交際費
    isConvertible: true,
    notes: "個人的娯楽・外食は経費不可。取引先接待分のみ。損金算入上限あり",
  },
  {
    homeCode: "H-3025",
    corporateCode: "7300", // 旅費交通費（接待旅行は接待交際費）
    isConvertible: true,
    notes: "事業関連出張→旅費交通費(7300)、接待旅行→接待交際費(8000)。目的で科目が変わる",
  },
  {
    homeCode: "H-3026",
    corporateCode: "7800", // 福利厚生費（研修費は独立科目設定推奨）
    isConvertible: true,
    notes: "業務に直接関連するスキルアップのみ研修費として計上可",
  },
  // 保険料
  {
    homeCode: "H-3009",
    corporateCode: "7800", // 福利厚生費（法定福利費・預り金は独立科目設定推奨）
    isConvertible: true,
    notes: "🔄 分離必要: 会社負担分→法定福利費、個人負担分→預り金",
  },
  {
    homeCode: "H-3010",
    corporateCode: "8100", // 損害保険料
    isConvertible: true,
    notes: "法人契約か個人契約かで科目・税務処理が変わる",
  },
  {
    homeCode: "H-3027",
    corporateCode: "8100",
    isConvertible: true,
    notes: "法人契約形態（定期/終身/逓増）で損金算入額が変わる。要確認",
  },
  {
    homeCode: "H-3011",
    corporateCode: "8100",
    isConvertible: true,
    notes: "私用兼業の場合は事業使用割合で按分計算が必要",
  },
  {
    homeCode: "H-3028",
    corporateCode: "8100",
    isConvertible: true,
    notes: "事業用部分のみ算入可。自宅兼事務所は面積按分が必要",
  },
  {
    homeCode: "H-3029",
    corporateCode: null,
    isConvertible: false,
    notes: "法人経費として認定不可。個人の生命保険料控除として申告",
  },
  // 税金
  {
    homeCode: "H-3030",
    corporateCode: "8200", // 租税公課（法人税等は独立科目設定推奨）
    isConvertible: true,
    notes: "個人所得税とは性質が根本的に異なる。法人税等として計上",
  },
  {
    homeCode: "H-3014",
    corporateCode: "8200",
    isConvertible: true,
    notes: "個人住民税とは性質が異なる。法人住民税（法人税等）として計上",
  },
  {
    homeCode: "H-3013",
    corporateCode: "8200", // 租税公課
    isConvertible: true,
    notes: "自動車税・印紙税等と統合して租税公課1科目に。事業用固定資産分のみ算入可",
  },
  {
    homeCode: "H-3012",
    corporateCode: "8200",
    isConvertible: true,
    notes: "租税公課として計上。事業用車両分のみ算入可",
  },
  // サブスクリプション・メディア
  {
    homeCode: "H-3031",
    corporateCode: "7100", // 消耗品費（新聞図書費は独立科目設定推奨）
    isConvertible: true,
    notes: "業務関連のニュース・情報収集のみ算入可",
  },
  {
    homeCode: "H-3032",
    corporateCode: "7000", // 通信費
    isConvertible: true,
    notes: "業務利用のツール・ソフトのみ算入可。ソフトウェアは消耗品費(7100)の場合も",
  },
  // その他固定費
  {
    homeCode: "H-3015",
    corporateCode: "7100", // 消耗品費（内容により細分化）
    isConvertible: true,
    notes: "🔄 細分化必要: 消耗品費(7100)/外注費/広告宣伝費等、内容に応じて分類",
  },
  {
    homeCode: "H-3016",
    corporateCode: "7100",
    isConvertible: true,
    notes: "10万円未満→消耗品費(7100)、10万円以上→固定資産計上・減価償却が必要",
  },
  {
    homeCode: "H-3017",
    corporateCode: null,
    isConvertible: false,
    notes: "個人的支出とみなされ法人経費として原則認定不可",
  },
  {
    homeCode: "H-3033",
    corporateCode: "8300", // 雑費（寄付金は独立科目設定推奨）
    isConvertible: true,
    notes: "寄付金として計上。損金算入上限（資本金等の0.25%＋所得の2.5%）に注意",
  },
  {
    homeCode: "H-3034",
    corporateCode: null,
    isConvertible: false,
    notes: "家事費として法人経費不可",
  },
];

// ── 負債・ローン（LIABILITY）─────────────────────────────────────────────
const LIABILITY_RULES: MappingRule[] = [
  {
    homeCode: "H-4001",
    corporateCode: "3400", // 借入金（長期/短期は独立科目設定推奨）
    isConvertible: true,
    notes: "1年以内返済分→短期借入金、それ以上→長期借入金に分離",
  },
  {
    homeCode: "H-4002",
    corporateCode: "3400",
    isConvertible: true,
    notes: "割賦購入かファイナンスリースかで科目・償却方法が異なる",
  },
  {
    homeCode: "H-4003",
    corporateCode: null,
    isConvertible: false,
    notes: "個人負債のため法人帳簿には計上しない",
  },
  {
    homeCode: "H-4004",
    corporateCode: "3400",
    isConvertible: true,
    notes: "事業運転資金として借り入れた場合のみ短期借入金として計上可",
  },
  {
    homeCode: "H-4005",
    corporateCode: "3400",
    isConvertible: true,
    notes: "返済期間（1年以内/超）で長期/短期に分類。事業目的借入のみ",
  },
];

// ── 経過勘定（ASSET / LIABILITY）────────────────────────────────────────
const ACCRUAL_RULES: MappingRule[] = [
  {
    homeCode: "H-5001",
    corporateCode: "1500", // 前払費用
    isConvertible: true,
    notes: "そのまま使用可。決算整理仕訳で対応",
  },
  {
    homeCode: "H-5002",
    corporateCode: "3200", // 未払費用
    isConvertible: true,
    notes: "未払費用または未払金。科目は慣行で選択",
  },
  {
    homeCode: "H-5003",
    corporateCode: "1600", // 未収収益
    isConvertible: true,
    notes: "売掛金と未収収益の区分基準を統一",
  },
  {
    homeCode: "H-5004",
    corporateCode: "3300", // 前受収益
    isConvertible: true,
    notes: "そのまま使用可",
  },
];

const ALL_RULES: MappingRule[] = [
  ...REVENUE_RULES,
  ...COGS_RULES,
  ...EXPENSE_RULES,
  ...LIABILITY_RULES,
  ...ACCRUAL_RULES,
];

async function main() {
  console.log("🌱 勘定科目変換マスタ seed 開始...");
  let upserted = 0;

  // userId が null の複合ユニークキー（homeCode_userId）は Prisma の upsert で
  // 直接指定できないため（NULL は比較不可）、findFirst + create/update で代用する。
  for (const rule of ALL_RULES) {
    const existing = await prisma.accountMappingRule.findFirst({
      where: { homeCode: rule.homeCode, userId: null },
    });
    const data = {
      corporateCode: rule.corporateCode,
      isConvertible: rule.isConvertible,
      notes: rule.notes,
      matchType: "TABLE" as const,
      confidenceScore: 1.0,
    };
    if (existing) {
      await prisma.accountMappingRule.update({ where: { id: existing.id }, data });
    } else {
      await prisma.accountMappingRule.create({
        data: { homeCode: rule.homeCode, userId: null, ...data },
      });
    }
    upserted++;
  }

  const convertible = ALL_RULES.filter((r) => r.isConvertible).length;
  const nonConvertible = ALL_RULES.filter((r) => !r.isConvertible).length;

  console.log(`✅ ${upserted} 件の変換ルールを upsert しました`);
  console.log(`   変換可能: ${convertible} 件 / 変換不可(❌): ${nonConvertible} 件`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
