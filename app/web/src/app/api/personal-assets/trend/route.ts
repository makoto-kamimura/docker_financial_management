import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { monthKeysBetween } from "@/lib/shared/asset-valuation";
import {
  assetMonthlySeries,
  estimateAssetValue,
  VALUATION_INCLUDE,
} from "@/lib/assets/personal-asset-valuation";

const ym = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;

// GET /api/personal-assets/trend?back=36&forward=60 … 実物資産の評価額の推移（月末ごと。読み取り専用）
//   今月の back か月前から forward か月先まで。評価額を手で入れた点（と取得日の取得価格）を通り、
//   最後の点から先は価値の変わり方で見積もる（lib/shared/asset-valuation.ts）。資産管理の推移グラフが使う。
//   total は「資産計上」の資産の合計（総資産サマリと同じ範囲）。持っていない月は null
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    back: z.coerce.number().int().min(0).max(240).default(36),
    forward: z.coerce.number().int().min(0).max(240).default(60),
  }),
  handler: async ({ user, db, query }) => {
    const assets = await db.personalAsset.findMany({
      where: { tenantId: user.tenantId },
      orderBy: { createdAt: "asc" },
      include: VALUATION_INCLUDE,
    });

    const now = new Date();
    const from = ym(new Date(now.getFullYear(), now.getMonth() - query.back, 1));
    const to = ym(new Date(now.getFullYear(), now.getMonth() + query.forward, 1));
    const months = monthKeysBetween(from, to);

    const rows = assets.map((a) => {
      const { series, parts } = assetMonthlySeries(a, months);
      const nowValue = estimateAssetValue(a, now);
      return {
        id: a.id,
        name: a.name,
        category: a.category,
        countAsAsset: a.countAsAsset,
        estimatedValue: nowValue === null ? null : Math.round(nowValue),
        series,
        parts,
      };
    });
    const counted = rows.filter((r) => r.countAsAsset);
    const total = months.map((_, i) =>
      counted.every((r) => r.series[i] === null)
        ? null
        : counted.reduce((s, r) => s + (r.series[i] ?? 0), 0),
    );

    return NextResponse.json({ data: { months, currentKey: ym(now), total, assets: rows } });
  },
});
