/**
 * 家庭モード科目コード → 個人事業主モード / 法人モードでの表示科目名
 *
 * 出典: docs/account-master-mapping.md（家庭科目名・個人事業主科目名・法人科目名）
 * ここに定義した表示名は Account.soleName / Account.corporateName の既定値として seed される。
 * `※対応なし` や `❌ 経費不可` はマスタ上の注記をそのまま表示名として保持する。
 * 経過勘定（H-5001〜H-5004）はマッピング表に無いため家庭科目名と同一とする。
 */
export type AccountDisplayNames = { sole: string; corporate: string };

export const ACCOUNT_DISPLAY_NAMES: Record<string, AccountDisplayNames> = {
  // ── 1. 収入（REVENUE）──────────────────────────────────────────
  "H-1001": { sole: "※帳簿外（給与所得として確定申告）", corporate: "役員報酬 / 給与手当" },
  "H-1002": { sole: "※帳簿外（給与所得として確定申告）", corporate: "賞与" },
  "H-1003": { sole: "雑収入 / ※帳簿外（配当所得）", corporate: "受取配当金" },
  "H-1004": { sole: "雑収入 / ※帳簿外", corporate: "受取配当金 / 有価証券売却益" },
  "H-1005": { sole: "雑収入 / ※帳簿外", corporate: "受取利息" },
  "H-1006": { sole: "不動産賃貸収入", corporate: "不動産賃貸収入" },
  "H-1007": { sole: "売上高", corporate: "売上高" },
  "H-1008": { sole: "売上高 / 雑収入", corporate: "売上高 / 雑収入" },
  "H-1009": { sole: "※帳簿外（雑所得）", corporate: "※対応なし" },
  "H-1010": { sole: "※非課税・帳簿外", corporate: "※対応なし" },
  "H-1011": { sole: "※非課税・帳簿外 / 雑収入", corporate: "補助金収入 / 雑収入" },
  "H-1012": { sole: "雑収入", corporate: "雑収入" },
  "H-1013": { sole: "雑収入 / 売上高", corporate: "売上高 / 雑収入" },
  "H-1014": { sole: "雑収入（雑所得）", corporate: "雑収入 / 暗号資産売却益" },
  "H-1015": { sole: "雑収入", corporate: "雑収入" },
  "H-1016": { sole: "※帳簿外（贈与または生活費）", corporate: "※対応なし" },

  // ── 2. 変動生活費（COGS）───────────────────────────────────────
  "H-2001": { sole: "会議費 / 接待交際費", corporate: "会議費 / 福利厚生費 / 接待交際費" },
  "H-2002": { sole: "会議費 / 福利厚生費", corporate: "会議費 / 福利厚生費" },
  "H-2003": { sole: "❌ 経費不可", corporate: "福利厚生費" },
  "H-2004": { sole: "消耗品費", corporate: "消耗品費" },
  "H-2005": { sole: "❌ 経費不可", corporate: "福利厚生費" },
  "H-2006": { sole: "❌ 経費不可", corporate: "福利厚生費" },
  "H-2007": { sole: "❌ 経費不可", corporate: "消耗品費" },
  "H-2008": { sole: "❌ 経費不可", corporate: "❌ 経費不可" },
  "H-2009": { sole: "研修費 / 新聞図書費", corporate: "研修費 / 教育訓練費" },
  "H-2010": { sole: "❌ 経費不可", corporate: "福利厚生費" },
  "H-2011": { sole: "新聞図書費", corporate: "新聞図書費" },
  "H-2012": { sole: "❌ 経費不可", corporate: "❌ 経費不可" },
  "H-2013": { sole: "❌ 経費不可", corporate: "❌ 経費不可" },
  "H-2014": { sole: "❌ 経費不可", corporate: "❌ 経費不可" },
  "H-2015": { sole: "接待交際費", corporate: "接待交際費" },
  "H-2016": { sole: "接待交際費", corporate: "接待交際費" },
  "H-2017": { sole: "❌ 経費不可", corporate: "❌ 経費不可" },

  // ── 3. 固定費・経費（EXPENSE）──────────────────────────────────
  "H-3001": { sole: "水道光熱費（按分）", corporate: "水道光熱費" },
  "H-3002": { sole: "水道光熱費（按分）", corporate: "水道光熱費" },
  "H-3003": { sole: "水道光熱費（按分）", corporate: "水道光熱費" },
  "H-3004": { sole: "通信費（按分）", corporate: "通信費" },
  "H-3005": { sole: "通信費（按分）", corporate: "通信費" },
  "H-3006": { sole: "旅費交通費", corporate: "旅費交通費" },
  "H-3007": { sole: "旅費交通費", corporate: "旅費交通費" },
  "H-3008": { sole: "接待交際費", corporate: "接待交際費" },
  "H-3009": { sole: "租税公課（国保・国民年金）", corporate: "法定福利費 / 預り金" },
  "H-3010": { sole: "損害保険料 / ❌", corporate: "保険料 / 福利厚生費" },
  "H-3011": { sole: "損害保険料（按分）", corporate: "損害保険料 / 車両費" },
  "H-3012": { sole: "租税公課（按分）", corporate: "租税公課" },
  "H-3013": { sole: "租税公課（按分）", corporate: "租税公課" },
  "H-3014": { sole: "❌（個人税負担）", corporate: "法人住民税（法人税等）" },
  "H-3015": {
    sole: "消耗品費 / 外注費 / 広告宣伝費 等",
    corporate: "消耗品費 / 外注費 / 広告宣伝費 等",
  },
  "H-3016": { sole: "消耗品費 / 工具器具備品 / 減価償却費", corporate: "消耗品費 / 工具器具備品" },
  "H-3017": { sole: "❌ 経費不可", corporate: "❌ 経費不可" },
  "H-3018": { sole: "地代家賃（按分）", corporate: "地代家賃" },
  "H-3019": { sole: "地代家賃 / 修繕費（按分）", corporate: "地代家賃" },
  "H-3020": { sole: "修繕費（按分）", corporate: "修繕費" },
  "H-3021": { sole: "車両費（按分）", corporate: "車両費" },
  "H-3022": { sole: "車両費（按分）", corporate: "車両費" },
  "H-3023": { sole: "車両費（按分）", corporate: "車両費" },
  "H-3024": { sole: "旅費交通費（按分）", corporate: "旅費交通費" },
  "H-3025": { sole: "旅費交通費 / 接待交際費", corporate: "旅費交通費 / 接待交際費" },
  "H-3026": { sole: "研修費", corporate: "研修費" },
  "H-3027": { sole: "❌（生命保険料控除）", corporate: "保険料 / 福利厚生費" },
  "H-3028": { sole: "損害保険料（按分）", corporate: "損害保険料" },
  "H-3029": { sole: "❌（生命保険料控除）", corporate: "❌ 経費不可" },
  "H-3030": { sole: "❌（個人税負担）", corporate: "法人税等" },
  "H-3031": { sole: "新聞図書費 / 通信費", corporate: "新聞図書費" },
  "H-3032": { sole: "通信費 / 消耗品費", corporate: "通信費 / 消耗品費" },
  "H-3033": { sole: "租税公課（ふるさと納税） / ❌", corporate: "寄付金" },
  "H-3034": { sole: "❌ 経費不可", corporate: "❌ 経費不可" },

  // ── 4. 負債・ローン（LIABILITY）───────────────────────────────
  "H-4001": { sole: "長期借入金（按分）", corporate: "長期借入金 / 短期借入金" },
  "H-4002": { sole: "長期借入金（按分）", corporate: "長期借入金 / リース債務" },
  "H-4003": { sole: "※個人負債（帳簿外）", corporate: "※対応なし" },
  "H-4004": { sole: "※個人負債 / 短期借入金", corporate: "短期借入金" },
  "H-4005": { sole: "借入金", corporate: "長期借入金 / 短期借入金" },

  // ── 5. 経過勘定（マッピング表対象外・家庭科目名と同一）────────
  "H-5001": { sole: "前払費用", corporate: "前払費用" },
  "H-5002": { sole: "未払費用", corporate: "未払費用" },
  "H-5003": { sole: "未収収益", corporate: "未収収益" },
  "H-5004": { sole: "前受収益", corporate: "前受収益" },
};
