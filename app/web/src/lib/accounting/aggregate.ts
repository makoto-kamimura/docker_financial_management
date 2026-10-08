// 集計の粒度
export type Granularity = "month" | "quarter" | "year";

// 集計対象の 1 レコード（DB の financial_records + periods を結合した形）
export type RecordWithPeriod = {
  amount: number;
  fiscalYear: number;
  quarter: number; // 1-4
  month: number; // 1-12
};

export type AggregateBucket = {
  key: string; // 例: "2025-04" / "2025-Q1" / "2025"
  total: number;
};

// 指定した粒度で期間ごとに金額を合計する
export function aggregate(
  records: RecordWithPeriod[],
  granularity: Granularity,
): AggregateBucket[] {
  const byKey = new Map<string, number>();

  for (const r of records) {
    const key = bucketKey(r, granularity);
    byKey.set(key, (byKey.get(key) ?? 0) + r.amount);
  }

  return [...byKey.entries()]
    .map(([key, total]) => ({ key, total }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

// レコードを粒度ごとのキー文字列に変換する
export function bucketKey(r: RecordWithPeriod, granularity: Granularity): string {
  switch (granularity) {
    case "month":
      return `${r.fiscalYear}-${String(r.month).padStart(2, "0")}`;
    case "quarter":
      return `${r.fiscalYear}-Q${r.quarter}`;
    case "year":
      return `${r.fiscalYear}`;
  }
}
