import { NextRequest, NextResponse } from "next/server";
import { forecastLinear } from "@/lib/forecast";

// バックエンド API: GET /api/forecasts?months=6
// 過去実績から将来 N か月の推移を予測して返す。
// NOTE: Phase 1 は線形回帰ベース。Phase 3 で季節性を考慮した手法に拡張する。
const sampleHistory = [12_000_000, 13_500_000, 15_200_000, 14_800_000, 16_100_000];

export async function GET(req: NextRequest) {
  const months = Number(req.nextUrl.searchParams.get("months") ?? "6");
  const forecast = forecastLinear(sampleHistory, months);
  return NextResponse.json({ history: sampleHistory, forecast });
}
