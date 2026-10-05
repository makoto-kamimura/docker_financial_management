// ダッシュボードの「予実と確定」（web 版 components/BudgetCyclePanel.tsx と同じ流れ）。
// 月ごとに ① → ② → ③ の順に進める（順番は API が強制）。
//   ① その月の予算を確定する（初回は「そのまま確定」。以降は前月の ③ で確定済みになっている）
//   ② 明細の最終日（銀行・カード・電子マネー）が月末日までそろうと「実績入力済み」になるので、
//      ボタンで実績を確定する（POST /actuals/confirm）
//   ③ 予算と実績を科目ごとに比べ（GET /budgets/variance）、差額の扱いを選んで翌月の予算案を作り、
//      「確定」で翌月の予算を確定する（POST /budgets/confirm。計算は shared/budget-cycle.ts）
// 画面幅が狭いので、web 版の「予算と実績」と「予算案」の 2 つの表を科目ごとの 1 ブロックにまとめる。
import { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  confirmActuals,
  confirmBudget,
  fetchAccounts,
  fetchBudgetVariance,
  unconfirmActuals,
  unconfirmBudget,
  type Account,
  type BudgetVariance,
  type BudgetVarianceRow,
  type ViewMode,
} from "../api";
import { digitsOnly, yen } from "../format";
import {
  defaultTreatment,
  isExpenseCategory,
  isTreatmentAllowed,
  planNextBudget,
  type NextBudgetItem,
  type VarianceTreatment,
} from "../shared/budget-cycle";
import { displayName } from "../shared/display-name";
import { BUDGET_HELP, DASHBOARD_HELP, textFor } from "../shared/help-texts";
import { AccountPickerModal } from "./CategoryPickerModal";
import { Button, COLORS, Input, Notice, Pills, TermList } from "./ui";
import { YearMonthPicker } from "./YearMonthPicker";

const signedYen = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${yen(Math.abs(v))}`;

const TREATMENTS: { value: VarianceTreatment; label: string }[] = [
  { value: "none", label: "何もしない" },
  { value: "timing", label: "期ズレとして翌月へ" },
  { value: "transfer", label: "回し先へ" },
];

// 回し先の候補は費用の科目（家計の貯蓄・投資も費用として扱う）
const TRANSFER_CATEGORIES = ["EXPENSE", "COGS"] as const;

// 実績の月が締まるのは翌月なので、既定は前月を比べる（翌月＝今月の予算を確定する）
function defaultTargetMonth(): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

type Props = {
  viewMode: ViewMode;
  /** 値が変わると読み直す（ダッシュボードの引っ張って更新） */
  refreshKey: number;
};

export function BudgetCycleSection({ viewMode, refreshKey }: Props) {
  const household = viewMode === "household";
  const [target, setTarget] = useState(defaultTargetMonth);
  const [year, month] = target.split("-").map(Number);

  const [data, setData] = useState<BudgetVariance | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const [treatments, setTreatments] = useState<Map<number, VarianceTreatment>>(new Map());
  const [transferTargetId, setTransferTargetId] = useState<number | null>(null);
  // 翌月の予算案を手で直した金額（流用など）。科目 ID → 入力中の文字列
  const [overrides, setOverrides] = useState<Map<number, string>>(new Map());
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, [refreshKey]);

  useEffect(() => {
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
  // 予実の行に無い科目の案（回し先が当月に予算も実績も無いとき）
  const extraPlan = plan.filter((i) => !data?.rows.some((r) => r.accountId === i.accountId));

  const finalAmount = (accountId: number, planned: number) => {
    const o = overrides.get(accountId);
    if (o === undefined || o.trim() === "") return planned;
    return Math.round(Number(o));
  };

  const nextTotals = plan.reduce(
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

  function confirm(targetYear: number, targetMonth: number, withPlan: boolean) {
    const label = `${targetYear}年${targetMonth}月`;
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
              await confirmBudget({ year: targetYear, month: targetMonth, items });
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

  function unconfirm(targetYear: number, targetMonth: number) {
    const label = `${targetYear}年${targetMonth}月`;
    Alert.alert("確定の解除", `${label}の予算の確定を解除します。予算の金額は変わりません。`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "解除",
        style: "destructive",
        onPress: async () => {
          setBusy(true);
          try {
            await unconfirmBudget(targetYear, targetMonth);
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

  function confirmActualsOfMonth() {
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

  function unconfirmActualsOfMonth() {
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

  const diffColor = (r: BudgetVarianceRow) =>
    r.favorable === null ? COLORS.sub : r.favorable ? COLORS.success : COLORS.danger;
  const diffLabel = (r: BudgetVarianceRow) => {
    if (r.difference === 0) return "予算どおり";
    if (isExpenseCategory(r.category)) return r.difference < 0 ? "余り" : "超過";
    return r.difference > 0 ? "上振れ" : "不足";
  };

  const nextLabel = data ? `${data.next.year}年${data.next.month}月` : "翌月";
  const nextLocked = !!data?.nextConfirmedAt;
  const actualsLocked = !!data?.actuals.confirmedAt;
  // ③ 翌月の予算を確定できない理由（② が済んでいない）
  const nextBlockedReason = !data
    ? null
    : !data.confirmedAt
      ? `先に${month}月の予算（①）と実績（②）を確定してください。`
      : !actualsLocked
        ? `先に${month}月の実績（②）を確定してください。`
        : null;

  // 翌月の予算案（金額の手直しつき）。予実の行の下と、行に無い科目のブロックで使う
  const renderPlan = (item: NextBudgetItem) => {
    const override = overrides.get(item.accountId);
    const edited = override !== undefined;
    return (
      <View style={s.planBox}>
        <View style={s.planHead}>
          <Text style={s.planLabel}>{nextLabel}の予算案</Text>
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
            editable={!nextLocked}
            keyboardType="number-pad"
            accessibilityLabel={`${nameOf(item.accountId)}の${nextLabel}の予算`}
            style={[s.amountInput, edited && s.amountEdited, nextLocked && s.amountLocked]}
          />
          {edited && !nextLocked && (
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
      <Text style={s.title}>予実と確定</Text>
      <Text style={s.note}>{textFor(DASHBOARD_HELP.cycle, viewMode)}</Text>

      {/* 対象月と確定状況 */}
      <YearMonthPicker
        label="比べる月"
        value={target}
        onChange={(v) => {
          if (v) setTarget(v);
        }}
      />
      {data && (
        <View style={s.badges}>
          <StatusBadge label={`① ${month}月の予算`} confirmedAt={data.confirmedAt} />
          <ActualsBadge
            label={`② ${month}月の実績`}
            confirmedAt={data.actuals.confirmedAt}
            entered={data.actuals.entered}
          />
          <StatusBadge label={`③ ${data.next.month}月の予算`} confirmedAt={data.nextConfirmedAt} />
        </View>
      )}
      {data && !data.confirmedAt && data.rows.some((r) => r.budget !== null) && (
        <>
          <Button
            label={`${month}月の予算をそのまま確定`}
            variant="secondary"
            small
            disabled={busy || data.prevActualsPending}
            onPress={() => confirm(year, month, false)}
            style={s.sideBtn}
          />
          {data.prevActualsPending && (
            <Text style={s.blocked}>
              前月の実績が確定していないため、まだ確定できません。前月を選んで実績を確定してください。
            </Text>
          )}
        </>
      )}
      {data?.confirmedAt && (
        <Button
          label={`${month}月の予算の確定を解除`}
          variant="secondary"
          small
          disabled={busy || actualsLocked}
          onPress={() => unconfirm(year, month)}
          style={s.sideBtn}
        />
      )}

      {loading && <ActivityIndicator color={COLORS.primary} style={s.spinner} />}
      {!loading && error && <Notice tone="error">{error}</Notice>}

      {!loading && data && (
        <ActualsBlock
          month={month}
          actuals={data.actuals}
          budgetConfirmed={!!data.confirmedAt}
          nextConfirmed={nextLocked}
          busy={busy}
          lead={textFor(DASHBOARD_HELP.cycleActuals, viewMode)}
          onConfirm={confirmActualsOfMonth}
          onUnconfirm={unconfirmActualsOfMonth}
        />
      )}

      {!loading && data && data.rows.length === 0 && (
        <Text style={s.empty}>
          {year}年{month}月には、予算も実績もまだありません。
        </Text>
      )}

      {!loading && data && data.rows.length > 0 && (
        <>
          {/* 合計 */}
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

          {/* 余りの回し先 */}
          <View style={s.transferRow}>
            <Text style={s.transferLabel}>
              {household ? "余りの回し先（貯蓄など）" : "余りの回し先（流用先）"}
            </Text>
            <TouchableOpacity
              style={s.transferField}
              disabled={nextLocked}
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
                予算管理の「予算配分」で「貯蓄・投資」に科目をひも付けると、ここの既定になります。
              </Text>
            )}
          </View>

          <TermList terms={DASHBOARD_HELP.cycleTreatments} label="差額の扱いの説明" />

          {nextLocked ? (
            <Notice tone="info">
              {nextLabel}の予算は確定済みです。{BUDGET_HELP.cycleLocked}
            </Notice>
          ) : (
            <Text style={s.note}>
              科目ごとに差額の扱いを選ぶと、{nextLabel}
              の予算案に反映されます。科目の間で予算を移す（流用する）ときは、案の金額を直接書き換えてください。ローン返済などの自動反映は、案には含めず表示のときに上乗せされます。
            </Text>
          )}

          {/* 科目ごとの予実・差額の扱い・翌月の予算案 */}
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
                {r.difference !== 0 && (
                  <Pills
                    options={TREATMENTS}
                    value={current}
                    scroll={false}
                    onChange={(t) => setTreatments((m) => new Map(m).set(r.accountId, t))}
                    disabled={(t) => nextLocked || !isTreatmentAllowed(r, t, transferTargetId)}
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

          {/* 翌月の合計と確定 */}
          <View style={s.footer}>
            {plan.length === 0 ? (
              <Text style={s.empty}>翌月に引き継ぐ予算がありません。</Text>
            ) : (
              <Text style={s.totals}>
                {nextLabel}の予算案：{household ? "収入" : "売上・収入"} {yen(nextTotals.revenue)} −{" "}
                {household ? "支出" : "費用"} {yen(nextTotals.expense)} ={" "}
                <Text
                  style={{
                    color:
                      nextTotals.revenue - nextTotals.expense < 0 ? COLORS.danger : COLORS.text,
                    fontWeight: "600",
                  }}
                >
                  {signedYen(nextTotals.revenue - nextTotals.expense)}
                </Text>
              </Text>
            )}
            {nextLocked ? (
              <Button
                label={`${nextLabel}の確定を解除`}
                variant="secondary"
                disabled={busy}
                onPress={() => unconfirm(data.next.year, data.next.month)}
              />
            ) : (
              <Button
                label={`この予算で${nextLabel}を確定`}
                loading={busy}
                disabled={plan.length === 0 || !!nextBlockedReason}
                onPress={() => confirm(data.next.year, data.next.month, true)}
              />
            )}
            {!nextLocked && nextBlockedReason && <Text style={s.blocked}>{nextBlockedReason}</Text>}
            <Text style={s.note}>
              確定した予算は、{nextLabel}の実績と比べる基準になります。{nextLabel}
              が終わって明細がそろったら、上の「比べる月」で{nextLabel}
              を選び、実績の確定（②）から同じ手順で進めます。
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

function StatusBadge({ label, confirmedAt }: { label: string; confirmedAt: string | null }) {
  return (
    <View style={[s.badge, confirmedAt ? s.badgeDone : s.badgeOpen]}>
      <Text style={[s.badgeText, confirmedAt ? s.badgeTextDone : s.badgeTextOpen]}>
        {confirmedAt ? `🔒 ${label}：確定済み` : `${label}：未確定`}
      </Text>
    </View>
  );
}

function ActualsBadge({
  label,
  confirmedAt,
  entered,
}: {
  label: string;
  confirmedAt: string | null;
  entered: boolean;
}) {
  if (confirmedAt) return <StatusBadge label={label} confirmedAt={confirmedAt} />;
  return (
    <View style={[s.badge, entered ? s.badgeEntered : s.badgeWaiting]}>
      <Text style={[s.badgeText, entered ? s.badgeTextEntered : s.badgeTextWaiting]}>
        {entered ? `${label}：入力済み` : `${label}：入力待ち`}
      </Text>
    </View>
  );
}

const formatYmd = (ymd: string) => {
  const [y, m, d] = ymd.split("-").map(Number);
  return `${y}/${m}/${d}`;
};

// ② 実績の確定。明細の最終日をソースごとに出し、全ソースが月末日まで届いたら確定できる
function ActualsBlock({
  month,
  actuals,
  budgetConfirmed,
  nextConfirmed,
  busy,
  lead,
  onConfirm,
  onUnconfirm,
}: {
  month: number;
  actuals: BudgetVariance["actuals"];
  budgetConfirmed: boolean;
  nextConfirmed: boolean;
  busy: boolean;
  lead: string | undefined;
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
      {locked ? (
        <Notice tone="info">
          {month}月の実績は確定済みです。{DASHBOARD_HELP.actualsLocked}
        </Notice>
      ) : (
        lead && <Text style={s.note}>{lead}</Text>
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

function SummaryTile({
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

function Figure({
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
  hint: { fontSize: 11, color: COLORS.muted, lineHeight: 16, marginTop: 4 },
  empty: { fontSize: 12, color: COLORS.muted, marginVertical: 8 },
  spinner: { marginVertical: 16 },

  badges: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3 },
  badgeDone: { backgroundColor: "#ecfdf5" },
  badgeOpen: { backgroundColor: "#f1f5f9" },
  badgeText: { fontSize: 11 },
  badgeTextDone: { color: "#047857" },
  badgeTextOpen: { color: "#475569" },
  badgeEntered: { backgroundColor: "#f0f9ff" },
  badgeWaiting: { backgroundColor: "#fffbeb" },
  badgeTextEntered: { color: "#0369a1" },
  badgeTextWaiting: { color: "#b45309" },
  sideBtn: { alignSelf: "flex-start", marginBottom: 10 },
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
  figure: { flex: 1 },
  figureLabel: { fontSize: 10, color: COLORS.sub },
  figureValue: { fontSize: 13, fontVariant: ["tabular-nums"] },
  figureSub: { fontSize: 10 },

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
