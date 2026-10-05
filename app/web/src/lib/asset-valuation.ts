// 実物資産の価値の推移（評価額の見積もり）。資産管理の推移グラフ・総資産サマリ（ダッシュボード）で使う。
// Web とモバイルで共有する（shared-with-mobile.ts）。lib 内の相対 import 以外に依存させないこと。
//
// 考え方:
//   - 評価額を手で入れた点（登録時・更新時。personal_asset_valuations）と、取得日の取得価格を「実際の点」とする。
//   - 点と点の間は、日数で直線に結ぶ。
//   - 最後の点から先は「価値の変わり方」で見積もる。手で評価額を直すと、その値から先を見積もり直す。
//   - 取得日より前は持っていないので null（グラフに出さない）。
//
// 価値の変わり方（method）:
//   auto          種別から自動。建物は構造の年数で取得価格から 0 円へ定額、車は年 20% の定率、
//                 土地・金・投資は年率（既定 0%）、現金・預金・その他は変わらない
//   fixed         変わらない
//   rate          年率で増減（マイナスで下落）
//   straight_line 耐用年数で 0 円へ定額で減る（取得日から数える）
//   declining     定率で減る（年の下落率）

export type AssetCategory =
  | "LAND"
  | "BUILDING"
  | "VEHICLE"
  | "GOLD"
  | "CASH"
  | "DEPOSIT"
  | "SECURITIES"
  | "OTHER";

export const VALUATION_METHODS = ["auto", "fixed", "rate", "straight_line", "declining"] as const;
export type ValuationMethod = (typeof VALUATION_METHODS)[number];

export const VALUATION_METHOD_LABEL: Record<ValuationMethod, string> = {
  auto: "自動（種別から）",
  fixed: "変わらない",
  rate: "年率で増減",
  straight_line: "耐用年数で 0 円へ（定額）",
  declining: "毎年一定の割合で減る（定率）",
};

export const BUILDING_STRUCTURES = ["wood", "light_steel", "heavy_steel", "rc"] as const;
export type BuildingStructure = (typeof BUILDING_STRUCTURES)[number];

/** 建物の構造ごとの年数（住宅用の法定耐用年数） */
export const BUILDING_LIFE_YEARS: Record<BuildingStructure, number> = {
  wood: 22,
  light_steel: 27,
  heavy_steel: 34,
  rc: 47,
};

export const BUILDING_STRUCTURE_LABEL: Record<BuildingStructure, string> = {
  wood: "木造",
  light_steel: "軽量鉄骨",
  heavy_steel: "重量鉄骨",
  rc: "鉄筋コンクリート",
};

/** 車の自動の下落率（年 %） */
export const VEHICLE_DECLINING_RATE = 20;
/** 定率で減るときの既定の下落率（年 %） */
export const DEFAULT_DECLINING_RATE = 20;

export type ValuationSettings = {
  category: AssetCategory;
  method: ValuationMethod;
  /** 年率（%）。rate は増減率、declining は下落率。auto では土地・金・投資の増減率 */
  ratePercent: number | null;
  /** straight_line の年数 */
  usefulLifeYears: number | null;
  /** auto の建物の構造（未指定は木造） */
  structure: BuildingStructure | null;
};

export type ResolvedRule =
  | { kind: "fixed" }
  | { kind: "rate"; ratePercent: number }
  | { kind: "declining"; ratePercent: number }
  | { kind: "straight_line"; lifeYears: number };

/** 価値の変わり方を、実際の計算の形に直す（auto を種別から決める） */
export function resolveRule(s: ValuationSettings): ResolvedRule {
  const rate = s.ratePercent ?? 0;
  switch (s.method) {
    case "fixed":
      return { kind: "fixed" };
    case "rate":
      return { kind: "rate", ratePercent: rate };
    case "declining":
      return { kind: "declining", ratePercent: s.ratePercent ?? DEFAULT_DECLINING_RATE };
    case "straight_line":
      return {
        kind: "straight_line",
        lifeYears: s.usefulLifeYears ?? BUILDING_LIFE_YEARS[s.structure ?? "wood"],
      };
    case "auto":
    default:
      switch (s.category) {
        case "BUILDING":
          return { kind: "straight_line", lifeYears: BUILDING_LIFE_YEARS[s.structure ?? "wood"] };
        case "VEHICLE":
          return { kind: "declining", ratePercent: VEHICLE_DECLINING_RATE };
        case "LAND":
        case "GOLD":
        case "SECURITIES":
          return { kind: "rate", ratePercent: rate };
        default:
          return { kind: "fixed" };
      }
  }
}

export type ValueTrend = "up" | "down" | "flat";

/** 見積もりの向き（上がる・下がる・変わらない） */
export function trendOf(rule: ResolvedRule): ValueTrend {
  switch (rule.kind) {
    case "fixed":
      return "flat";
    case "rate":
      return rule.ratePercent > 0 ? "up" : rule.ratePercent < 0 ? "down" : "flat";
    case "declining":
      return rule.ratePercent > 0 ? "down" : "flat";
    case "straight_line":
      return "down";
  }
}

export const TREND_LABEL: Record<ValueTrend, string> = {
  up: "上がる見込み",
  down: "下がる見込み",
  flat: "横ばい",
};

/** 画面に出す説明（例: 「木造 22 年で 0 円へ（定額）」「年 +1.5%」） */
export function describeRule(
  rule: ResolvedRule,
  s?: Pick<ValuationSettings, "method" | "category" | "structure">,
): string {
  switch (rule.kind) {
    case "fixed":
      return "変わらない";
    case "rate":
      return rule.ratePercent === 0
        ? "横ばい（年 0%）"
        : `年 ${rule.ratePercent > 0 ? "+" : ""}${rule.ratePercent}%`;
    case "declining":
      return `毎年 ${rule.ratePercent}% ずつ減る（定率）`;
    case "straight_line": {
      const structure =
        s && s.method === "auto" && s.category === "BUILDING"
          ? `${BUILDING_STRUCTURE_LABEL[s.structure ?? "wood"]} `
          : "";
      return `${structure}${rule.lifeYears} 年で 0 円へ（定額）`;
    }
  }
}

export type ValuationPoint = { on: Date; value: number };

export type ValuationInput = ValuationSettings & {
  acquiredOn: Date | null;
  acquisitionCost: number | null;
  /** 評価額を手で入れた点（順不同） */
  valuations: ValuationPoint[];
};

const DAY = 24 * 60 * 60 * 1000;
const YEAR_DAYS = 365.25;
const dayIndex = (d: Date) =>
  Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);

/** 実際の点（取得日の取得価格＋手で入れた評価額）を日付順に。同じ日は手で入れた値を優先する */
export function valuationPoints(input: ValuationInput): ValuationPoint[] {
  const byDay = new Map<number, ValuationPoint>();
  if (input.acquiredOn && input.acquisitionCost !== null && input.acquisitionCost >= 0) {
    byDay.set(dayIndex(input.acquiredOn), { on: input.acquiredOn, value: input.acquisitionCost });
  }
  // 同じ日に複数あれば後に入れたもの（配列の後ろ）を使う
  for (const v of input.valuations) byDay.set(dayIndex(v.on), v);
  return [...byDay.entries()].sort((a, b) => a[0] - b[0]).map(([, v]) => v);
}

/** 最後の点 from から date までを、価値の変わり方で見積もる */
function project(rule: ResolvedRule, from: ValuationPoint, date: Date, lifeStart: Date): number {
  const years = (dayIndex(date) - dayIndex(from.on)) / YEAR_DAYS;
  switch (rule.kind) {
    case "fixed":
      return from.value;
    case "rate":
      return from.value * Math.pow(1 + rule.ratePercent / 100, years);
    case "declining":
      return from.value * Math.pow(1 - Math.min(rule.ratePercent, 100) / 100, years);
    case "straight_line": {
      // 取得日から lifeYears 年で 0 円。最後の点の値から、その日へ向けて直線で減らす
      const end = dayIndex(lifeStart) + rule.lifeYears * YEAR_DAYS;
      const start = dayIndex(from.on);
      // 年数を過ぎてから手で入れた値は、それ以上減らさない（まだ価値があると判断したもの）
      if (start >= end) return from.value;
      const t = dayIndex(date);
      if (t >= end) return 0;
      return from.value * ((end - t) / (end - start));
    }
  }
}

/**
 * date 時点の評価額の見積もり。取得日より前は null（持っていない）。
 * 点が 1 つも無ければ null。
 */
export function estimateValue(input: ValuationInput, date: Date): number | null {
  const points = valuationPoints(input);
  if (points.length === 0) return null;
  const t = dayIndex(date);
  if (input.acquiredOn && t < dayIndex(input.acquiredOn)) return null;
  const first = points[0];
  if (t <= dayIndex(first.on)) return first.value;
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const ta = dayIndex(a.on);
    const tb = dayIndex(b.on);
    if (t <= tb) return a.value + ((b.value - a.value) * (t - ta)) / (tb - ta);
  }
  const last = points[points.length - 1];
  return Math.max(0, project(resolveRule(input), last, date, input.acquiredOn ?? first.on));
}

/** "YYYY-MM" の月末日 */
export function monthEndOf(key: string): Date {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m, 0);
}

/** 月末ごとの見積もり（円単位に丸める）。持っていない月は null */
export function monthlyValues(input: ValuationInput, monthKeys: string[]): (number | null)[] {
  return monthKeys.map((k) => {
    const v = estimateValue(input, monthEndOf(k));
    return v === null ? null : Math.round(v);
  });
}

/** from から to まで（両端を含む）の "YYYY-MM" の列 */
export function monthKeysBetween(from: string, to: string): string[] {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  const keys: string[] = [];
  for (let i = fy * 12 + fm - 1; i <= ty * 12 + tm - 1; i++) {
    keys.push(`${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`);
  }
  return keys;
}
