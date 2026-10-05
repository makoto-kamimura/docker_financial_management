// 実績の画面の「実績の確定」タブ（web 版 components/ActualsConfirmPanel.tsx と同じ流れ）。
// 月ごとの流れ ① → ② → ③（順番は API が強制）のうち ② を受け持つ。
//   銀行・カード・電子マネーの明細の最終日が月末日までそろうと「実績入力済み」になるので、
//   ボタンで実績を確定する（POST /actuals/confirm）。
//   前提の ① と、あとに続く ③ は予算の画面の「予算の確定」タブ（BudgetConfirmSection.tsx）で行う。
import { useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, View } from "react-native";
import {
  confirmActuals,
  fetchCycleStatus,
  unconfirmActuals,
  type CycleStatus,
  type ViewMode,
} from "../api";
import { ENTRY_HELP, textFor } from "../shared/help-texts";
import { CycleSteps, defaultCycleMonth, formatYmd } from "./CycleSteps";
import { Button, COLORS, Notice } from "./ui";
import { YearMonthPicker } from "./YearMonthPicker";

type Props = {
  viewMode: ViewMode;
  /** 対象月の初期値（YYYY-MM）。省略時は前月 */
  initialMonth?: string;
  /** 値が変わると読み直す（引っ張って更新） */
  refreshKey?: number;
  /** 予算の画面の「予算の確定」へ移る */
  onOpenBudget?: (month: string) => void;
};

export function ActualsConfirmSection({
  viewMode,
  initialMonth,
  refreshKey = 0,
  onOpenBudget,
}: Props) {
  const [target, setTarget] = useState(() => initialMonth ?? defaultCycleMonth());
  const [year, month] = target.split("-").map(Number);
  const [data, setData] = useState<CycleStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchCycleStatus(year, month)
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setError(e instanceof Error ? e.message : "確定状況の取得に失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, month, refreshKey, reloadKey]);

  function confirm() {
    const label = `${year}年${month}月`;
    Alert.alert(
      "実績の確定",
      `${label}の実績を確定します。確定すると、${label}の実績は登録・変更・削除や明細の転記ができなくなります。よろしいですか？`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "確定",
          onPress: async () => {
            setBusy(true);
            try {
              await confirmActuals(year, month);
              Alert.alert("確定しました", `${label}の実績を確定しました。`);
              setReloadKey((k) => k + 1);
            } catch (e) {
              Alert.alert("確定エラー", e instanceof Error ? e.message : "確定に失敗しました");
            } finally {
              setBusy(false);
            }
          },
        },
      ],
    );
  }

  function unconfirm() {
    const label = `${year}年${month}月`;
    Alert.alert("確定の解除", `${label}の実績の確定を解除します。実績の金額は変わりません。`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "解除",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await unconfirmActuals(year, month);
            setReloadKey((k) => k + 1);
          } catch (e) {
            Alert.alert("解除エラー", e instanceof Error ? e.message : "解除に失敗しました");
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  const openBudget = onOpenBudget && (() => onOpenBudget(target));

  return (
    <View style={s.card}>
      <Text style={s.title}>実績の確定</Text>
      <Text style={s.note}>{textFor(ENTRY_HELP.confirm, viewMode)}</Text>

      <YearMonthPicker
        label="対象月"
        value={target}
        onChange={(v) => {
          if (v) setTarget(v);
        }}
      />
      {data && <CycleSteps status={data} onPressBudget={openBudget} />}

      {loading && <ActivityIndicator color={COLORS.primary} style={s.spinner} />}
      {!loading && error && <Notice tone="error">{error}</Notice>}

      {!loading && data && !data.confirmedAt && (
        <Text style={s.blocked}>
          実績を確定する前に、{month}月の予算（①）を確定してください。
          {openBudget && (
            <Text style={s.link} onPress={openBudget}>
              {" "}
              予算の確定へ
            </Text>
          )}
        </Text>
      )}

      {!loading && data && (
        <ActualsBlock
          month={month}
          actuals={data.actuals}
          budgetConfirmed={!!data.confirmedAt}
          nextConfirmed={!!data.nextConfirmedAt}
          busy={busy}
          onConfirm={confirm}
          onUnconfirm={unconfirm}
        />
      )}

      {!loading && data?.actuals.confirmedAt && !data.nextConfirmedAt && (
        <Text style={s.note}>
          次は、予算の画面で{month}月の予算と実績を比べ、{data.next.month}
          月の予算を確定します（③）。
          {openBudget && (
            <Text style={s.link} onPress={openBudget}>
              {" "}
              予算の確定へ
            </Text>
          )}
        </Text>
      )}
    </View>
  );
}

// ② 実績の確定。明細の最終日をソースごとに出し、全ソースが月末日まで届いたら確定できる
function ActualsBlock({
  month,
  actuals,
  budgetConfirmed,
  nextConfirmed,
  busy,
  onConfirm,
  onUnconfirm,
}: {
  month: number;
  actuals: CycleStatus["actuals"];
  budgetConfirmed: boolean;
  nextConfirmed: boolean;
  busy: boolean;
  onConfirm: () => void;
  onUnconfirm: () => void;
}) {
  const locked = !!actuals.confirmedAt;
  const lagging = new Set(actuals.lagging.map((l) => `${l.kind}:${l.id}`));
  const blockedReason = !budgetConfirmed
    ? `先に${month}月の予算（①）を確定してください。`
    : !actuals.entered
      ? actuals.coveredThrough
        ? `明細が月末（${formatYmd(actuals.monthEnd)}）までそろうと確定できます。`
        : "明細を取り込むと確定できます。"
      : null;

  return (
    <View style={s.actualsBox}>
      <Text style={s.actualsTitle}>
        {locked ? "🔒 " : ""}② {month}月の実績
      </Text>
      {locked && (
        <Notice tone="info">
          {month}月の実績は確定済みです。{ENTRY_HELP.actualsLocked}
        </Notice>
      )}
      {actuals.sources.length === 0 ? (
        <Text style={s.empty}>銀行口座・カード・電子マネーが登録されていません。</Text>
      ) : (
        actuals.sources.map((src) => {
          const late = lagging.has(`${src.kind}:${src.id}`);
          return (
            <View key={`${src.kind}:${src.id}`} style={s.sourceRow}>
              <View style={s.sourceName}>
                <Text style={s.sourceNameText}>{src.name}</Text>
                <Text style={s.sourceType}>{src.typeLabel}</Text>
              </View>
              <View style={s.sourceStatus}>
                <Text style={[s.sourceDate, late && { color: COLORS.danger, fontWeight: "600" }]}>
                  {src.lastDate ? formatYmd(src.lastDate) : "—"}
                </Text>
                <Text
                  style={[
                    s.sourceType,
                    {
                      color:
                        src.lastDate === null
                          ? COLORS.muted
                          : late
                            ? COLORS.danger
                            : COLORS.success,
                    },
                  ]}
                >
                  {src.lastDate === null
                    ? "明細なし（判定に含めない）"
                    : late
                      ? "月末まで届いていません"
                      : "入力済み"}
                </Text>
              </View>
            </View>
          );
        })
      )}
      {locked ? (
        <Button
          label={`${month}月の実績の確定を解除`}
          variant="secondary"
          small
          disabled={busy || nextConfirmed}
          onPress={onUnconfirm}
          style={s.actualsBtn}
        />
      ) : (
        <Button
          label={`${month}月の実績を確定`}
          small
          loading={busy}
          disabled={!!blockedReason}
          onPress={onConfirm}
          style={s.actualsBtn}
        />
      )}
      {!locked && blockedReason && <Text style={s.blocked}>{blockedReason}</Text>}
      {!locked && actuals.unposted > 0 && (
        <Text style={s.hint}>
          {month}月の明細のうち {actuals.unposted} 件がまだ実績に転記されていません。
        </Text>
      )}
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
  hint: { fontSize: 11, color: COLORS.muted, lineHeight: 16, marginTop: 4 },
  empty: { fontSize: 12, color: COLORS.muted, marginVertical: 8 },
  spinner: { marginVertical: 16 },
  link: { color: COLORS.primary, textDecorationLine: "underline" },
  blocked: { fontSize: 11, color: COLORS.warn, lineHeight: 16, marginBottom: 8 },

  actualsBox: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  actualsTitle: { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 6 },
  sourceRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
    paddingVertical: 6,
    gap: 8,
  },
  sourceName: { flex: 1 },
  sourceNameText: { fontSize: 13, color: COLORS.text },
  sourceType: { fontSize: 10, color: COLORS.sub },
  sourceStatus: { alignItems: "flex-end" },
  sourceDate: { fontSize: 13, color: COLORS.text, fontVariant: ["tabular-nums"] },
  actualsBtn: { alignSelf: "flex-start", marginTop: 8 },
});
