// 表示モード（家計 / 個人 / 法人）ごとの損益の用語。資金フロー図と KPI カードで共用する。
// モバイル版は app/mobile/src/shared/ に同じ内容を複製している（npm run sync:mobile で同期）。
import type { ViewMode } from "./display-name";

// 表示モードの切替（ヘッダーのボタン。label は正式名、short は狭い画面用）
export const VIEW_MODES: { value: ViewMode; label: string; short: string }[] = [
  { value: "household", label: "家計簿", short: "家計" },
  { value: "sole", label: "個人会計", short: "個人" },
  { value: "corporate", label: "法人", short: "法人" },
];

export type ModeLabels = {
  revenue: string;
  cogs: string;
  grossProfit: string;
  expense: string;
  operatingProfit: string;
};

export const MODE_LABELS: Record<ViewMode, ModeLabels> = {
  household: {
    revenue: "収入",
    cogs: "変動費",
    grossProfit: "収支差額",
    expense: "固定費",
    operatingProfit: "手残り",
  },
  sole: {
    revenue: "売上",
    cogs: "仕入・変動費",
    grossProfit: "粗利",
    expense: "経費",
    operatingProfit: "事業利益",
  },
  corporate: {
    revenue: "売上高",
    cogs: "売上原価",
    grossProfit: "売上総利益",
    expense: "販管費",
    operatingProfit: "営業利益",
  },
};

// KPI カードの見出し。個人・法人は MODE_LABELS と同じ用語、家計は「貯蓄」の言葉で見せる（手残り＝貯蓄額）。
export type KpiLabels = {
  revenue: string;
  grossProfit: string;
  grossMargin: string;
  profit: string;
  profitRate: string;
};

function kpiLabelsOf(mode: ViewMode): KpiLabels {
  const m = MODE_LABELS[mode];
  return {
    revenue: m.revenue,
    grossProfit: m.grossProfit,
    grossMargin: `${m.grossProfit}率`,
    profit: m.operatingProfit,
    profitRate: `${m.operatingProfit}率`,
  };
}

export const KPI_LABELS: Record<ViewMode, KpiLabels> = {
  household: { ...kpiLabelsOf("household"), profit: "貯蓄額", profitRate: "貯蓄率" },
  sole: kpiLabelsOf("sole"),
  corporate: kpiLabelsOf("corporate"),
};
