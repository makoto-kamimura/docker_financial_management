// 予算の画面の「予実差確認」タブ（web 版 components/BudgetVariancePanel.tsx と同じ）。
// 選んだ月の予算と実績を科目ごとに比べて見るだけの画面（GET /budgets/variance）。
// 差額の扱いを選んで翌月の予算案を作り、確定するのは「予算の確定」タブ（BudgetConfirmSection.tsx）。
// 年は画面上部の対象年度、月は月ボタンで選ぶ（use-cycle-month.ts）。
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import {
  fetchBudgetVariance,
  type BudgetVariance,
  type BudgetVarianceRow,
  type ViewMode,
} from "../api";
import { yen } from "../format";
import { isExpenseCategory, nextYearMonth } from "../shared/budget-cycle";
import { cycleKey } from "../shared/cycle-month";
import { displayName } from "../shared/display-name";
import { BUDGET_HELP, textFor } from "../shared/help-texts";
import { useCycleMonth } from "../use-cycle-month";
import { CycleSteps } from "./CycleSteps";
import { MonthPills } from "./MonthPills";
import { Button, COLORS, Notice } from "./ui";

export const signedYen = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${yen(Math.abs(v))}`;

/** 差の色（有利なら緑、不利なら赤） */
export const diffColor = (r: BudgetVarianceRow) =>
  r.favorable === null ? COLORS.sub : r.favorable ? COLORS.success : COLORS.danger;
/** 差の呼び方（費用は余り・超過、収入は上振れ・不足） */
export const diffLabel = (r: BudgetVarianceRow) => {
  if (r.difference === 0) return "予算どおり";
  if (isExpenseCategory(r.category)) return r.difference < 0 ? "余り" : "超過";
  return r.difference > 0 ? "上振れ" : "不足";
};

type Props = {
  viewMode: ViewMode;
  /** 比べる月の初期値（YYYY-MM）。省略時は最後に実績を確定した月 */
  initialMonth?: string;
  /** 「予算の確定」タブを、指定した予算の月（YYYY-MM）で開く */
  onOpenConfirm: (month: string) => void;
  /** 実績の画面の「実績の確定」へ移る */
  onOpenActuals?: (month: string) => void;
};

export function BudgetVarianceSection({
  viewMode,
  initialMonth,
  onOpenConfirm,
  onOpenActuals,
}: Props) {
  const household = viewMode === "household";
  const { year, month, setMonth } = useCycleMonth("variance", initialMonth);
  const [data, setData] = useState<BudgetVariance | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (month === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchBudgetVariance(year, month)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setError(e instanceof Error ? e.message : "予実の取得に失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month]);

  const next = month !== null ? nextYearMonth(year, month) : null;
  // 翌月の予算だけがある科目（この月は予算も実績も無い）は、比べるものが無いので出さない
  const rows = (data?.rows ?? []).filter(
    (r) => r.budget !== null || r.overlay !== 0 || r.actual !== 0,
  );

  return (
    <View style={s.card}>
      <Text style={s.title}>予実差確認</Text>
      <Text style={s.note}>{textFor(BUDGET_HELP.variance, viewMode)}</Text>

      <MonthPills label="比べる月" year={year} month={month} onChange={setMonth} />
      {data && <CycleSteps status={data} onPressActuals={onOpenActuals} />}

      {loading && <ActivityIndicator color={COLORS.primary} style={s.spinner} />}
      {!loading && error && <Notice tone="error">{error}</Notice>}

      {!loading && data && rows.length === 0 && (
        <Text style={s.empty}>
          {year}年{month}月には、予算も実績もまだありません。
        </Text>
      )}

      {!loading && data && rows.length > 0 && (
        <>
          <View style={s.tiles}>
            <SummaryTile
              title={household ? "収入" : "売上・収入"}
              main={yen(data.summary.revenue.actual)}
              sub={`予算 ${yen(data.summary.revenue.plan)}`}
            />
            <SummaryTile
              title={household ? "支出" : "費用"}
              main={yen(data.summary.expense.actual)}
              sub={`予算 ${yen(data.summary.expense.plan)}`}
            />
            <SummaryTile
              title="余った額"
              main={yen(data.summary.surplusTotal)}
              sub="予算より少なく済んだ費用の合計"
              color={COLORS.success}
            />
            <SummaryTile
              title="超えた額"
              main={yen(data.summary.overrunTotal)}
              sub="予算を超えた費用の合計"
              color={COLORS.danger}
            />
          </View>

          {rows.map((r) => (
            <View key={r.accountId} style={s.row}>
              <Text style={s.rowName}>
                <Text style={s.rowCode}>{r.accountCode} </Text>
                {displayName(r, viewMode)}
              </Text>
              <View style={s.figures}>
                <Figure
                  label="予算"
                  value={r.budget === null && r.overlay === 0 ? "—" : yen(r.plan)}
                  sub={r.overlay > 0 ? `内 自動反映 ${yen(r.overlay)}` : undefined}
                />
                <Figure label="実績" value={yen(r.actual)} />
                <Figure
                  label="差（実績−予算）"
                  value={signedYen(r.difference)}
                  sub={diffLabel(r)}
                  color={diffColor(r)}
                />
              </View>
            </View>
          ))}

          {next && (
            <View style={s.footer}>
              <Button
                label={`${next.month}月の予算案を作る`}
                onPress={() => onOpenConfirm(cycleKey(next.year, next.month))}
              />
              <Text style={s.note}>
                差額の扱いを選んで{next.month}月の予算を確定するのは「予算の確定」タブです。
              </Text>
            </View>
          )}
        </>
      )}
    </View>
  );
}

export function SummaryTile({
  title,
  main,
  sub,
  color = COLORS.text,
}: {
  title: string;
  main: string;
  sub: string;
  color?: string;
}) {
  return (
    <View style={s.tile}>
      <Text style={s.tileTitle}>{title}</Text>
      <Text style={[s.tileMain, { color }]}>{main}</Text>
      <Text style={s.tileSub}>{sub}</Text>
    </View>
  );
}

export function Figure({
  label,
  value,
  sub,
  color = COLORS.text,
}: {
  label: string;
  value: string;
  sub?: string;
  color?: string;
}) {
  return (
    <View style={s.figure}>
      <Text style={s.figureLabel}>{label}</Text>
      <Text style={[s.figureValue, { color }]}>{value}</Text>
      {sub ? <Text style={[s.figureSub, { color }]}>{sub}</Text> : null}
    </View>
  );
}

const s = StyleSheet.create({
  card: {
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 14,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginBottom: 12,
  },
  title: { fontSize: 13, fontWeight: "600", color: "#374151", marginBottom: 6 },
  note: { fontSize: 11, color: COLORS.sub, lineHeight: 16, marginBottom: 10 },
  empty: { fontSize: 12, color: COLORS.muted, marginVertical: 8 },
  spinner: { marginVertical: 16 },

  tiles: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  tile: {
    flexBasis: "47%",
    flexGrow: 1,
    backgroundColor: COLORS.bg,
    borderRadius: 8,
    padding: 10,
  },
  tileTitle: { fontSize: 11, color: COLORS.sub },
  tileMain: { fontSize: 16, fontWeight: "600", marginVertical: 2 },
  tileSub: { fontSize: 10, color: COLORS.muted },

  row: { borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingVertical: 10 },
  rowName: { fontSize: 13, fontWeight: "600", color: COLORS.text, marginBottom: 6 },
  rowCode: { fontSize: 11, fontWeight: "400", color: COLORS.muted },
  figures: { flexDirection: "row", gap: 8 },
  figure: { flex: 1 },
  figureLabel: { fontSize: 10, color: COLORS.sub },
  figureValue: { fontSize: 13, fontVariant: ["tabular-nums"] },
  figureSub: { fontSize: 10 },

  footer: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10, gap: 8 },
});
