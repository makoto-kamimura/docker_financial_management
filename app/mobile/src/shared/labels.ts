// 画面に出す区分・種別の表示名。Web とモバイルで同じ文言にするためここに集約する。
// モバイル版は app/mobile/src/shared/ に同じ内容を複製している（npm run sync:mobile で同期。
// 差分は shared-with-mobile.test.ts が検出する）。

// ── 勘定科目の区分（予算管理・実績管理の並び順と見出し）──────────────────
export const CATEGORY_ORDER = [
  "ASSET",
  "LIABILITY",
  "REVENUE",
  "COGS",
  "EXPENSE",
  "PROFIT",
  "OTHER",
] as const;

export const CATEGORY_LABEL: Record<string, string> = {
  ASSET: "資産",
  LIABILITY: "負債",
  REVENUE: "収入",
  COGS: "変動費",
  EXPENSE: "固定費",
  PROFIT: "貯蓄/利益",
  OTHER: "その他",
};

/** CATEGORY_ORDER での順位（未知の区分は末尾） */
export function categoryRank(category: string): number {
  const i = (CATEGORY_ORDER as readonly string[]).indexOf(category);
  return i < 0 ? CATEGORY_ORDER.length : i;
}

// ── 変更履歴の操作（予算・実績の「履歴」タブ）──────────────────────────
export const CHANGE_ACTION_LABEL: Record<string, string> = {
  create: "登録",
  update: "更新",
  delete: "削除",
};

// ── 銀行・カード明細の取得元 ─────────────────────────────────────────
export const TXN_SOURCE_LABEL: Record<string, string> = {
  MANUAL: "手動",
  CSV: "CSV",
  SYNC: "自動取得",
};

// ── 銀行口座の種別 ───────────────────────────────────────────────────
export const BANK_ACCOUNT_TYPE_LABEL: Record<string, string> = {
  ORDINARY: "普通預金",
  CURRENT: "当座預金",
  FIXED: "定期預金",
};

// ── 資金移動ルール（固定の入出金）の種別 ─────────────────────────────────
export const TRANSFER_CHANNEL_LABELS: Record<string, string> = {
  INCOME: "給与・収入",
  EXPENSE: "支出",
  BANK_TRANSFER: "銀行振込",
  AUTO_DEBIT: "銀行引き落とし",
  CARD_PAYMENT: "カード引き落とし",
};

// ── 実物資産の種別 ───────────────────────────────────────────────────
export const PERSONAL_ASSET_CATEGORY_LABEL = {
  LAND: "土地",
  BUILDING: "建物",
  VEHICLE: "車",
  GOLD: "金・貴金属",
  CASH: "現金（タンス預金）",
  DEPOSIT: "預金",
  SECURITIES: "投資（株式・投資信託等）",
  OTHER: "その他",
} as const;

export type PersonalAssetCategory = keyof typeof PERSONAL_ASSET_CATEGORY_LABEL;

// ── 借入の種別 ───────────────────────────────────────────────────────
// asset（実物資産の紐付け負債）は資産管理から自動作成されるため選択肢には出さない
export const LOAN_TYPES: { value: string; label: string }[] = [
  { value: "business", label: "事業性借入" },
  { value: "housing", label: "住宅ローン" },
  { value: "car", label: "カーローン" },
  { value: "education", label: "教育ローン・奨学金" },
  { value: "card", label: "カードローン・キャッシング" },
  { value: "personal", label: "フリーローン・多目的ローン" },
  { value: "shopping", label: "ショッピングローン・分割払い" },
  { value: "other", label: "その他の借入" },
];

export const LOAN_TYPE_LABEL: Record<string, string> = {
  ...Object.fromEntries(LOAN_TYPES.map((t) => [t.value, t.label])),
  asset: "実物資産の負債",
};
