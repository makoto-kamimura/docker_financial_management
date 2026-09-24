// 予測手法の選択肢と説明（ダッシュボードの「予測手法」）。lib/forecast.ts の各実装に対応する。
// モバイル版は app/mobile/src/shared/ に同じ内容を複製している（npm run sync:mobile で同期）。
export const DEFAULT_FORECAST_METHOD = "moving_average";

export const FORECAST_METHODS: { value: string; label: string; help: string }[] = [
  {
    value: "linear_regression",
    label: "線形回帰",
    help: "過去の実績に直線を当てはめて延長します。増減の傾向が一定のときに向きます。",
  },
  {
    value: "moving_average",
    label: "移動平均",
    help: "直近3か月の平均をそのまま将来値にします。増減が少なく横ばいのときに向きます（既定）。",
  },
  {
    value: "growth_rate",
    label: "成長率",
    help: "毎月の増減率（前月比）の平均を掛け続けます。一定のペースで伸び続ける項目に向きます。",
  },
  {
    value: "holt",
    label: "指数平滑(Holt)",
    help: "直近の実績を重く見ながら水準と傾きを更新します。傾向が途中で変わる項目に向きます。",
  },
  {
    value: "holt_winters",
    label: "季節性(Holt-Winters)",
    help: "水準・傾きに加えて毎年の季節変動も学習します。実績が2年分（24か月）未満のときは Holt と同じ計算になります。",
  },
];
