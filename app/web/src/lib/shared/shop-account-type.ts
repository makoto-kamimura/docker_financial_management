// 明細分け（明細管理で登録する、通販の注文の取り込み先。ShopAccount）の種類と、その既定。API と画面
// （web・モバイル）で同じ定義を使う。
//
// 種類は、既定の注文履歴のページと、紐付けるカード・銀行の明細の摘要のキーワードを決める。
// 明細分けにキーワードを登録すれば、既定より優先する（除外のキーワードも同じ）。
// 摘要は全角・半角と大文字・小文字をそろえて比べる（「ﾗｸﾃﾝ」も「ラクテン」に当たる）。

export const SHOP_ACCOUNT_TYPES = ["AMAZON", "YODOBASHI", "RAKUTEN", "OTHER"] as const;

export type ShopAccountType = (typeof SHOP_ACCOUNT_TYPES)[number];

export const SHOP_ACCOUNT_TYPE_LABELS: Record<ShopAccountType, string> = {
  AMAZON: "Amazon",
  YODOBASHI: "ヨドバシ.com",
  RAKUTEN: "楽天市場",
  OTHER: "その他",
};

type ShopPreset = {
  /** 紐付ける明細の摘要のキーワード（どれかを含めば当たる） */
  match: string[];
  /** 当たっても外すキーワード（Amazon の会費・楽天モバイルなど、注文でない支払い） */
  exclude: string[];
  /** 注文履歴のページ（ログインの後にたどる入口） */
  url: string | null;
};

export const SHOP_PRESETS: Record<ShopAccountType, ShopPreset> = {
  AMAZON: {
    match: ["AMAZON", "アマゾン"],
    exclude: ["PRIME", "プライム"],
    url: "https://www.amazon.co.jp/gp/css/order-history",
  },
  YODOBASHI: {
    match: ["YODOBASHI", "ヨドバシ"],
    exclude: [],
    url: "https://www.yodobashi.com/",
  },
  RAKUTEN: {
    match: ["RAKUTEN", "ラクテン", "楽天"],
    exclude: ["MOBILE", "モバイル", "銀行", "証券", "でんき", "ガス"],
    url: "https://order.my.rakuten.co.jp/",
  },
  OTHER: { match: [], exclude: [], url: null },
};

export function isShopAccountType(v: string): v is ShopAccountType {
  return (SHOP_ACCOUNT_TYPES as readonly string[]).includes(v);
}

/** 比べるための形（全角英数・半角カナをそろえ、空白を除き、大文字に） */
export function normalizeShopText(s: string): string {
  return s.normalize("NFKC").replace(/\s+/g, "").toUpperCase();
}

type KeywordSource = { type: string; matchKeywords?: string[]; excludeKeywords?: string[] };

/** その明細分けで使うキーワード（登録したものがあればそれ、無ければ種類の既定） */
export function shopKeywords(a: KeywordSource): { match: string[]; exclude: string[] } {
  const preset = isShopAccountType(a.type) ? SHOP_PRESETS[a.type] : SHOP_PRESETS.OTHER;
  const own = (list: string[] | undefined) => (list ?? []).map((k) => k.trim()).filter(Boolean);
  const match = own(a.matchKeywords);
  const exclude = own(a.excludeKeywords);
  return {
    match: match.length > 0 ? match : preset.match,
    exclude: exclude.length > 0 ? exclude : preset.exclude,
  };
}

/** 明細の摘要が、その明細分けの注文の支払いに見えるか（キーワードに当たり、除外に当たらない） */
export function matchesShopDescription(description: string, a: KeywordSource): boolean {
  const { match, exclude } = shopKeywords(a);
  const text = normalizeShopText(description);
  if (!match.some((k) => text.includes(normalizeShopText(k)))) return false;
  return !exclude.some((k) => text.includes(normalizeShopText(k)));
}

/** 注文履歴のページ（登録した URL があればそれ、無ければ種類の既定） */
export function shopOrderHistoryUrl(a: {
  type: string;
  statementUrl?: string | null;
}): string | null {
  const own = a.statementUrl?.trim();
  if (own) return own;
  return isShopAccountType(a.type) ? SHOP_PRESETS[a.type].url : null;
}

/** 画面で入力したキーワード（読点・カンマ・改行区切り）を配列にする */
export function parseKeywordList(text: string): string[] {
  return [
    ...new Set(
      text
        .split(/[、,，\n]/)
        .map((k) => k.trim())
        .filter(Boolean),
    ),
  ];
}
