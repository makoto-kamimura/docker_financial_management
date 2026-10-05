// 予算の画面の「予算の確定」タブ（web 版 components/BudgetConfirmPanel.tsx と同じ流れ）。
// 選んだ「予算の月」B の予算を確定する。月ごとの流れ ① → ② → ③（順番は API が強制）のうち予算の確定を受け持つ。
//   - 比べる月 C は B の前月。C の予算と実績の差（GET /budgets/variance）について扱いを選ぶと B の予算案ができ、
//     「確定」で B の予算を確定する（POST /budgets/confirm。計算は shared/budget-cycle.ts）。C から見た ③
//   - はじめて使うときなどは、B の予算をいま入っている金額のまま確定できる（B から見た ①）
//   - C の実績の確定（②）は実績の画面、C の予算と実績を見比べるのは「予実差確認」タブ（BudgetVarianceSection.tsx）
// 年は画面上部の対象年度、月は月ボタンで選ぶ（use-cycle-month.ts）。
// 画面幅が狭いので、科目ごとに「C 月の差・扱い・予算案」を 1 ブロックにまとめる。
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  confirmBudget,
  fetchAccounts,
  fetchBudgetVariance,
  fetchCycleStatus,
  unconfirmBudget,
  type Account,
  type BudgetVariance,
  type CycleStatus,
  type ViewMode,
} from "../api";
import { digitsOnly, yen } from "../format";
import {
  defaultTreatment,
  isTreatmentAllowed,
  planNextBudget,
  prevYearMonth,
  type NextBudgetItem,
  type VarianceTreatment,
} from "../shared/budget-cycle";
import { cycleKey } from "../shared/cycle-month";
import { displayName } from "../shared/display-name";
import { BUDGET_HELP, textFor } from "../shared/help-texts";
import { useCycleMonth } from "../use-cycle-month";
import { diffColor, diffLabel, Figure, signedYen } from "./BudgetVarianceSection";
import { AccountPickerModal } from "./CategoryPickerModal";
import { CycleSteps } from "./CycleSteps";
import { MonthPills } from "./MonthPills";
import { Button, COLORS, Input, Notice, Pills, TermList } from "./ui";

const TREATMENTS: { value: VarianceTreatment; label: string }[] = [
  { value: "none", label: "何もしない" },
  { value: "timing", label: "期ズレとして翌月へ" },
  { value: "transfer", label: "回し先へ" },
];

// 回し先の候補は費用の科目（家計の貯蓄・投資も費用として扱う）
const TRANSFER_CATEGORIES = ["EXPENSE", "COGS"] as const;

type Props = {
  viewMode: ViewMode;
  /** 予算の月の初期値（YYYY-MM）。省略時は最後に実績を確定した月の翌月 */
  initialMonth?: string;
  /** 値が変わると読み直す（引っ張って更新） */
  refreshKey?: number;
  /** 実績の画面の「実績の確定」へ移る */
  onOpenActuals?: (month: string) => void;
  /** 「予実差確認」タブを、指定した比べる月（YYYY-MM）で開く */
  onOpenVariance: (month: string) => void;
};

export function BudgetConfirmSection({
  viewMode,
  initialMonth,
  refreshKey = 0,
  onOpenActuals,
  onOpenVariance,
}: Props) {
  const household = viewMode === "household";
  const { year, month, setMonth } = useCycleMonth("budget", initialMonth);
  // 比べる月（予算の月の前月）
  const prev = month !== null ? prevYearMonth(year, month) : null;

  const [data, setData] = useState<BudgetVariance | null>(null);
  // 予算の月そのものの状況（その月の実績が確定済みか・前月の実績が未確定か）
  const [own, setOwn] = useState<CycleStatus | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [treatments, setTreatments] = useState<Map<number, VarianceTreatment>>(new Map());
  const [transferTargetId, setTransferTargetId] = useState<number | null>(null);
  // 予算案を手で直した金額（流用など）。科目 ID → 入力中の文字列
  const [overrides, setOverrides] = useState<Map<number, string>>(new Map());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [refreshKey]);

  useEffect(() => {
    if (month === null || prev === null) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([fetchBudgetVariance(prev.year, prev.month), fetchCycleStatus(year, month)])
      .then(([v, c]) => {
        if (cancelled) return;
        setData(v);
        setOwn(c);
      })
      .catch((e) => {
        if (cancelled) return;
        setData(null);
        setOwn(null);
        setError(e instanceof Error ? e.message : "予実の取得に失敗しました");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // prev は year・month から決まるので依存に含めない
  }, [year, month, refreshKey, reloadKey]);

  // 月・モードが変わったら、差額の扱いを既定に戻す
  useEffect(() => {
    if (!data) return;
    const t = data.transferTargetId;
    setTransferTargetId(t);
    setTreatments(
      new Map(
        data.rows.map((r) => [
          r.accountId,
          defaultTreatment(r, { household, hasTransferTarget: t !== null && t !== r.accountId }),
        ]),
      ),
    );
    setOverrides(new Map());
  }, [data, household]);

  const accountById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const nameOf = (id: number) => {
    const row = data?.rows.find((r) => r.accountId === id);
    if (row) return displayName(row, viewMode);
    const acct = accountById.get(id);
    return acct ? displayName(acct, viewMode) : `科目 ${id}`;
  };
  const codeOf = (id: number) =>
    data?.rows.find((r) => r.accountId === id)?.accountCode ?? accountById.get(id)?.code ?? "";
  const categoryOf = (id: number) =>
    data?.rows.find((r) => r.accountId === id)?.category ?? accountById.get(id)?.category ?? "";

  const plan = useMemo(() => {
    if (!data) return [];
    return planNextBudget({ rows: data.rows, treatments, transferTargetId });
  }, [data, treatments, transferTargetId]);
  const planById = useMemo(() => new Map(plan.map((i) => [i.accountId, i])), [plan]);
  // 比べる月の行に無い科目の案（回し先が比べる月に予算も実績も無いとき）
  const extraPlan = plan.filter((i) => !data?.rows.some((r) => r.accountId === i.accountId));

  const finalAmount = (accountId: number, planned: number) => {
    const o = overrides.get(accountId);
    if (o === undefined || o.trim() === "") return planned;
    return Math.round(Number(o));
  };

  const totals = plan.reduce(
    (acc, item) => {
      const amount = finalAmount(item.accountId, item.amount);
      if (categoryOf(item.accountId) === "REVENUE") acc.revenue += amount;
      else acc.expense += amount;
      return acc;
    },
    { revenue: 0, expense: 0 },
  );

  // 回し先を変えたら、選べなくなった「回し先へ」は「何もしない」に戻す
  function changeTransferTarget(nextTarget: number | null) {
    setTransferTargetId(nextTarget);
    setPickerOpen(false);
    if (!data) return;
    setTreatments((m) => {
      const n = new Map(m);
      for (const r of data.rows) {
        if (n.get(r.accountId) === "transfer" && !isTreatmentAllowed(r, "transfer", nextTarget)) {
          n.set(r.accountId, "none");
        }
      }
      return n;
    });
  }

  const label = `${year}年${month}月`;

  function confirm(withPlan: boolean) {
    if (month === null) return;
    Alert.alert(
      "予算の確定",
      withPlan
        ? `${label}の予算をこの案で確定します。確定すると、${label}の予算は変更できなくなります。よろしいですか？`
        : `${label}の予算を、いま入っている金額のまま確定します。よろしいですか？`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "確定",
          onPress: async () => {
            setBusy(true);
            try {
              const items = withPlan
                ? plan.map((i) => ({
                    accountId: i.accountId,
                    amount: finalAmount(i.accountId, i.amount),
                  }))
                : [];
              await confirmBudget({ year, month, items });
              Alert.alert("確定しました", `${label}の予算を確定しました。`);
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
    if (month === null) return;
    Alert.alert("確定の解除", `${label}の予算の確定を解除します。予算の金額は変わりません。`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "解除",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await unconfirmBudget(year, month);
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

  const locked = !!data?.nextConfirmedAt;
  const ownActualsLocked = !!own?.actuals.confirmedAt;
  const hasOwnBudget = !!data?.rows.some((r) => r.nextBudget !== null);
  // 比べる月から作る予算案で確定できない理由（比べる月の ① ② が済んでいない）
  const planBlockedReason =
    !data || !prev
      ? null
      : !data.confirmedAt
        ? `この案で確定するには、先に${prev.month}月の予算（①）と実績（②）を確定してください。`
        : !data.actuals.confirmedAt
          ? `この案で確定するには、先に実績の画面の「実績の確定」で${prev.month}月の実績（②）を確定してください。`
          : null;

  // 予算案（金額の手直しつき）。科目のブロックの下で使う
  const renderPlan = (item: NextBudgetItem) => {
    const override = overrides.get(item.accountId);
    const edited = override !== undefined;
    return (
      <View style={s.planBox}>
        <View style={s.planHead}>
          <Text style={s.planLabel}>{month}月の予算案</Text>
          <Text style={s.planCalc}>
            基準 {yen(item.base)}
            {item.adjustment !== 0 ? `　増減 ${signedYen(item.adjustment)}` : ""}
          </Text>
        </View>
        {item.notes.length > 0 && (
          <Text style={s.planNote}>
            {item.notes
              .map((n) =>
                n.kind === "timing"
                  ? `期ズレ ${signedYen(n.amount)}`
                  : `${nameOf(n.fromAccountId)}の余り ${signedYen(n.amount)}`,
              )
              .join("、")}
          </Text>
        )}
        {item.clamped && <Text style={s.planWarn}>差し引くと 0 円を下回るため 0 円にしました</Text>}
        <View style={s.amountRow}>
          <Input
            value={override ?? String(item.amount)}
            onChangeText={(v) => setOverrides((m) => new Map(m).set(item.accountId, digitsOnly(v)))}
            editable={!locked}
            keyboardType="number-pad"
            accessibilityLabel={`${nameOf(item.accountId)}の${label}の予算`}
            style={[s.amountInput, edited && s.amountEdited, locked && s.amountLocked]}
          />
          {edited && !locked && (
            <TouchableOpacity
              hitSlop={6}
              onPress={() =>
                setOverrides((m) => {
                  const n = new Map(m);
                  n.delete(item.accountId);
                  return n;
                })
              }
            >
              <Text style={s.resetText}>計算した金額に戻す</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  };

  return (
    <View style={s.card}>
      <Text style={s.title}>予算の確定</Text>
      <Text style={s.note}>{textFor(BUDGET_HELP.confirm, viewMode)}</Text>

      {/* 予算の月と、比べる月から見た確定状況（① 比べる月の予算 → ② 実績 → ③ この月の予算） */}
      <MonthPills label="予算の月" year={year} month={month} onChange={setMonth} />
      {data && <CycleSteps status={data} onPressActuals={onOpenActuals} />}
      {data && !locked && hasOwnBudget && (
        <>
          <Button
            label={`${month}月の予算をそのまま確定`}
            variant="secondary"
            small
            disabled={busy || !!own?.prevActualsPending}
            onPress={() => confirm(false)}
            style={s.sideBtn}
          />
          {own?.prevActualsPending && (
            <Text style={s.blocked}>
              前月の実績が確定していないため、まだ確定できません。実績の画面の「実績の確定」で前月の実績を確定してください。
            </Text>
          )}
        </>
      )}

      {loading && <ActivityIndicator color={COLORS.primary} style={s.spinner} />}
      {!loading && error && <Notice tone="error">{error}</Notice>}

      {!loading && data && prev && (
        <>
          {locked ? (
            <Notice tone="info">
              {label}の予算は確定済みです。{BUDGET_HELP.cycleLocked}
            </Notice>
          ) : (
            <Text style={s.note}>
              {prev.month}月の予算と実績の差について、科目ごとに扱いを選ぶと{month}
              月の予算案に反映されます。科目の間で予算を移す（流用する）ときは、案の金額を直接書き換えてください。ローン返済などの自動反映は、案には含めず表示のときに上乗せされます。
            </Text>
          )}
          <Text
            style={[s.link, s.varianceLink]}
            onPress={() => onOpenVariance(cycleKey(prev.year, prev.month))}
          >
            {prev.month}月の予実差を見る
          </Text>

          {/* 余りの回し先 */}
          <View style={s.transferRow}>
            <Text style={s.transferLabel}>
              {household ? "余りの回し先（貯蓄など）" : "余りの回し先（流用先）"}
            </Text>
            <TouchableOpacity
              style={s.transferField}
              disabled={locked}
              onPress={() => setPickerOpen(true)}
            >
              <Text style={transferTargetId === null ? s.transferPlaceholder : s.transferValue}>
                {transferTargetId === null
                  ? "指定しない"
                  : `${codeOf(transferTargetId)} ${nameOf(transferTargetId)}`}
              </Text>
            </TouchableOpacity>
            {data.transferTargetId === null && household && (
              <Text style={s.hint}>
                予算配分の「貯蓄・投資」に入る科目（科目名に「貯蓄」「積立」などを含む科目）が、ここの既定になります。
              </Text>
            )}
          </View>

          <TermList terms={BUDGET_HELP.cycleTreatments} label="差額の扱いの説明" />

          {data.rows.length === 0 && extraPlan.length === 0 && (
            <Text style={s.empty}>
              {prev.month}月と{month}月には、予算も実績もまだありません。
            </Text>
          )}

          {/* 科目ごとの、比べる月の差・差額の扱い・予算案 */}
          {data.rows.map((r) => {
            const current = treatments.get(r.accountId) ?? "none";
            const item = planById.get(r.accountId);
            return (
              <View key={r.accountId} style={s.row}>
                <Text style={s.rowName}>
                  <Text style={s.rowCode}>{r.accountCode} </Text>
                  {displayName(r, viewMode)}
                </Text>
                <View style={s.figures}>
                  <Figure
                    label={`${prev.month}月の差（実績−予算）`}
                    value={signedYen(r.difference)}
                    sub={diffLabel(r)}
                    color={diffColor(r)}
                  />
                </View>
                {r.difference !== 0 && (
                  <Pills
                    options={TREATMENTS}
                    value={current}
                    scroll={false}
                    onChange={(t) => setTreatments((m) => new Map(m).set(r.accountId, t))}
                    disabled={(t) => locked || !isTreatmentAllowed(r, t, transferTargetId)}
                  />
                )}
                {item && renderPlan(item)}
              </View>
            );
          })}
          {extraPlan.map((item) => (
            <View key={item.accountId} style={s.row}>
              <Text style={s.rowName}>
                <Text style={s.rowCode}>{codeOf(item.accountId)} </Text>
                {nameOf(item.accountId)}
              </Text>
              {renderPlan(item)}
            </View>
          ))}

          {/* 予算案の合計と確定 */}
          <View style={s.footer}>
            {plan.length > 0 && (
              <Text style={s.totals}>
                {month}月の予算案：{household ? "収入" : "売上・収入"} {yen(totals.revenue)} −{" "}
                {household ? "支出" : "費用"} {yen(totals.expense)} ={" "}
                <Text
                  style={{
                    color: totals.revenue - totals.expense < 0 ? COLORS.danger : COLORS.text,
                    fontWeight: "600",
                  }}
                >
                  {signedYen(totals.revenue - totals.expense)}
                </Text>
              </Text>
            )}
            {locked ? (
              <Button
                label={`${label}の確定を解除`}
                variant="secondary"
                disabled={busy || ownActualsLocked}
                onPress={unconfirm}
              />
            ) : (
              <Button
                label={`この予算で${label}を確定`}
                loading={busy}
                disabled={plan.length === 0 || !!planBlockedReason}
                onPress={() => confirm(true)}
              />
            )}
            {locked && ownActualsLocked && (
              <Text style={s.hint}>
                この月の実績が確定済みのため、先に実績の確定を解除してください。
              </Text>
            )}
            {!locked && planBlockedReason && (
              <Text style={s.blocked}>
                {planBlockedReason}
                {onOpenActuals && (
                  <Text
                    style={s.link}
                    onPress={() => onOpenActuals(cycleKey(prev.year, prev.month))}
                  >
                    {" "}
                    実績の確定へ
                  </Text>
                )}
              </Text>
            )}
            <Text style={s.note}>
              確定した予算は、{month}月の実績と比べる基準になります。{month}
              月が終わって明細がそろったら、実績の画面で{month}
              月の実績を確定（②）し、「予実差確認」で見比べてから、ここで翌月を選んで同じ手順で進めます。
            </Text>
          </View>
        </>
      )}

      <AccountPickerModal
        visible={pickerOpen}
        accounts={accounts}
        categories={TRANSFER_CATEGORIES}
        title="余りの回し先"
        clearLabel="指定しない"
        currentId={transferTargetId}
        onSelect={(a) => changeTransferTarget(a?.id ?? null)}
        onClose={() => setPickerOpen(false)}
      />
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

  sideBtn: { alignSelf: "flex-start", marginBottom: 10 },
  link: { color: COLORS.primary, textDecorationLine: "underline" },
  varianceLink: { fontSize: 12, marginBottom: 10 },
  blocked: { fontSize: 11, color: COLORS.warn, lineHeight: 16, marginBottom: 8 },

  transferRow: { marginBottom: 8 },
  transferLabel: { fontSize: 12, fontWeight: "500", color: "#475569", marginBottom: 4 },
  transferField: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  transferValue: { fontSize: 13, color: COLORS.text },
  transferPlaceholder: { fontSize: 13, color: COLORS.muted },

  row: { borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingVertical: 10 },
  rowName: { fontSize: 13, fontWeight: "600", color: COLORS.text, marginBottom: 6 },
  rowCode: { fontSize: 11, fontWeight: "400", color: COLORS.muted },
  figures: { flexDirection: "row", gap: 8, marginBottom: 6 },

  planBox: { backgroundColor: COLORS.bg, borderRadius: 8, padding: 8, marginTop: 6 },
  planHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "baseline",
    flexWrap: "wrap",
  },
  planLabel: { fontSize: 11, fontWeight: "600", color: "#475569" },
  planCalc: { fontSize: 11, color: COLORS.sub },
  planNote: { fontSize: 10, color: COLORS.sub, marginTop: 2 },
  planWarn: { fontSize: 10, color: COLORS.warn, marginTop: 2 },
  amountRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6 },
  amountInput: { flex: 1, textAlign: "right" },
  amountEdited: { borderColor: "#fbbf24", backgroundColor: "#fffbeb" },
  amountLocked: { backgroundColor: COLORS.bg, color: COLORS.sub },
  resetText: { fontSize: 11, color: COLORS.primary },

  footer: { borderTopWidth: 1, borderTopColor: COLORS.border, paddingTop: 10, gap: 8 },
  totals: { fontSize: 12, color: "#475569" },
});
