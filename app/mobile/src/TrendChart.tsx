import { View } from "react-native";
import Svg, { Circle, Polyline } from "react-native-svg";

// 実績(actual)・予測(forecast)の値配列を受け取り、簡易な折れ線で描画する。
export function TrendChart({
  actual,
  forecast,
  width = 320,
  height = 180,
}: {
  actual: number[];
  forecast: number[];
  width?: number;
  height?: number;
}) {
  const all = [...actual, ...forecast];
  if (all.length === 0) return <View style={{ width, height }} />;

  const max = Math.max(...all);
  const min = Math.min(...all);
  const range = max - min || 1;
  const pad = 12;
  const stepX = (width - pad * 2) / Math.max(all.length - 1, 1);

  const toPoint = (v: number, i: number) => {
    const x = pad + i * stepX;
    const y = height - pad - ((v - min) / range) * (height - pad * 2);
    return { x, y };
  };

  const actualPts = actual.map(toPoint);
  // 予測は実績の最終点から連結
  const forecastPts = forecast.map((v, i) => toPoint(v, actual.length - 1 + i + 1));
  const forecastLine = actualPts.length
    ? [actualPts[actualPts.length - 1], ...forecastPts]
    : forecastPts;

  return (
    <Svg width={width} height={height}>
      <Polyline
        points={actualPts.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="#2563eb"
        strokeWidth={2}
      />
      <Polyline
        points={forecastLine.map((p) => `${p.x},${p.y}`).join(" ")}
        fill="none"
        stroke="#f97316"
        strokeWidth={2}
        strokeDasharray="5,5"
      />
      {actualPts.map((p, i) => (
        <Circle key={`a${i}`} cx={p.x} cy={p.y} r={3} fill="#2563eb" />
      ))}
    </Svg>
  );
}
