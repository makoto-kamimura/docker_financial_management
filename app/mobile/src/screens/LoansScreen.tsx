// 借入金管理（web 版 /loans と同じ内容）。返済スケジュール・金利予測・変動前後の比較・金利改定時の参考月額は
// web と共有する shared/loan-schedule.ts で計算する（同じ入力なら同じ数字になる）。
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Polyline } from "react-native-svg";
import {
  fetchAccounts,
  fetchLoans,
  patchLoan,
  patchLoanRateChange,
  postLoan,
  postLoanRateChange,
  repayLoan,
  type Account,
  type Loan,
  type ViewMode,
} from "../api";
import { AccountPickerModal } from "../components/CategoryPickerModal";
import { LoanScheduleChart } from "../components/LoanScheduleChart";
import {
  Button,
  Card,
  EmptyText,
  Field,
  Input,
  Notice,
  Pills,
  SectionTitle,
  SheetModal,
} from "../components/ui";
import { yen } from "../format";
import { displayName } from "../shared/display-name";
import { LOAN_TYPE_LABEL, LOAN_TYPES } from "../shared/labels";
import {
  buildRateComparison,
  buildScheduleData,
  LOAN_COLORS,
  pendingRateChange,
  ratePercent,
  referenceMonthly,
} from "../shared/loan-schedule";

const today = () => new Date().toISOString().slice(0, 10);
const progressOf = (l: Loan) =>
  Number(l.amount) > 0 ? Math.round((1 - Number(l.remainingAmount) / Number(l.amount)) * 100) : 0;

// 変動金利の返済額の決まり方（web 版 HelpTip の VariableRateHelp と同じ説明）
function VariableRateHelp() {
  const [open, setOpen] = useState(false);
  return (
    <View>
      <TouchableOpacity onPress={() => setOpen((v) => !v)} hitSlop={8}>
        <Text style={s.helpLink}>{open ? "▲ 閉じる" : "？ 金利が変わると返済額はどうなる？"}</Text>
      </TouchableOpacity>
      {open && (
        <View style={s.helpBox}>
          <Text style={s.helpText}>
            <Text style={s.bold}>5 年ルール</Text>（多くの銀行が採用）… 金利が変わっても
            <Text style={s.bold}>毎月の返済額は 5 年間変わりません</Text>
            。変わるのは元本と利息の内訳だけで、金利が上がると元本の減りが遅くなります。返済額の見直しは
            5 年ごとです。
          </Text>
          <Text style={s.helpText}>
            <Text style={s.bold}>125% ルール</Text>… 5 年ごとの見直しでも、新しい返済額は従前の 1.25
            倍が上限です。上限に当たって利息を払いきれない分は「未払利息」として繰り延べられ、最終回に請求されることがあります。
          </Text>
          <Text style={s.helpText}>
            <Text style={s.bold}>都度見直し型</Text>（ソニー銀行・PayPay 銀行・SBI 新生銀行など）…
            これらのルールが無く、
            <Text style={s.bold}>金利改定のたびに返済額が再計算されます</Text>。
          </Text>
          <Text style={s.helpText}>
            どちらの方式かで正しい返済額が変わるため、このシステムでは
            <Text style={s.bold}>金融機関から通知された実際の金額を入力</Text>
            してもらい、それを正としています。表示される計算値はあくまで参考です。
          </Text>
        </View>
      )}
    </View>
  );
}

// 変動前後の残高推移（2 本の線だけの小さなグラフ）
function ComparisonChart({ points }: { points: { before: number; after: number }[] }) {
  const w = 300;
  const h = 120;
  const max = Math.max(1, ...points.flatMap((p) => [p.before, p.after]));
  const line = (key: "before" | "after") =>
    points
      .map((p, i) => `${(i / Math.max(1, points.length - 1)) * w},${h - (p[key] / max) * h}`)
      .join(" ");
  return (
    <View>
      <Svg width={w} height={h}>
        <Polyline
          points={line("before")}
          fill="none"
          stroke="#94a3b8"
          strokeWidth={2}
          strokeDasharray="5 5"
        />
        <Polyline points={line("after")} fill="none" stroke="#dc2626" strokeWidth={2} />
      </Svg>
      <Text style={s.muted}>
        灰色の破線＝変動前（当初金利のまま）、赤＝変動後（金利変更を反映）
      </Text>
    </View>
  );
}

type NewLoanForm = {
  lenderName: string;
  amount: string;
  interestRate: string;
  borrowedOn: string;
  repaymentDate: string;
  note: string;
  loanType: string;
  linkedAccountCode: string;
  monthlyPayment: string;
};
const BLANK_LOAN: NewLoanForm = {
  lenderName: "",
  amount: "",
  interestRate: "0",
  borrowedOn: "",
  repaymentDate: "",
  note: "",
  loanType: "business",
  linkedAccountCode: "",
  monthlyPayment: "",
};

type Props = { viewMode: ViewMode };

export function LoansScreen({ viewMode }: Props) {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showRates, setShowRates] = useState(true);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [newLoan, setNewLoan] = useState<NewLoanForm | null>(null);
  const [editForm, setEditForm] = useState<{
    loan: Loan;
    repaymentDate: string;
    monthlyPayment: string;
    residualValue: string;
    linkedAccountCode: string;
  } | null>(null);
  const [rateForm, setRateForm] = useState<{
    loan: Loan;
    effectiveOn: string;
    interestRate: string;
    monthlyPayment: string;
    note: string;
  } | null>(null);
  const [pendingForm, setPendingForm] = useState<{
    loan: Loan;
    changeId: number;
    monthlyPayment: string;
  } | null>(null);
  const [payForm, setPayForm] = useState<{
    loan: Loan;
    principal: string;
    interest: string;
    repaidOn: string;
  } | null>(null);
  const [sheetError, setSheetError] = useState<string | null>(null);
  // 予算連携先の科目選択（新規・編集の両方から開く）
  const [picking, setPicking] = useState<"new" | "edit" | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [ls, accs] = await Promise.all([fetchLoans(), fetchAccounts()]);
      setLoans(ls);
      setAccounts(accs);
    } catch (e) {
      setError(e instanceof Error ? e.message : "借入金の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // シートの保存。成功したらシートを閉じて一覧を取り直す
  async function submit(action: () => Promise<void>, close: () => void) {
    setSheetError(null);
    try {
      await action();
      close();
      await load();
    } catch (e) {
      setSheetError(e instanceof Error ? e.message : "保存に失敗しました");
    }
  }

  const scheduleData = useMemo(() => buildScheduleData(loans), [loans]);
  const activeLoans = loans.filter((l) => l.status === "active");
  const totalBorrowed = loans.reduce((sum, l) => sum + Number(l.amount), 0);
  const totalRemaining = activeLoans.reduce((sum, l) => sum + Number(l.remainingAmount), 0);
  const expenseAccounts = accounts.filter((a) => a.category === "EXPENSE");
  const accountLabel = (code: string, empty: string) => {
    const a = accounts.find((x) => x.code === code);
    return a ? `${a.code} ${displayName(a, viewMode)}` : empty;
  };
  const toggle = (key: string) => setExpanded((e) => ({ ...e, [key]: !e[key] }));

  // 金利変更シートの参考月額（残高 × 残回数）
  const rateRef =
    rateForm && rateForm.interestRate !== ""
      ? referenceMonthly(rateForm.loan, rateForm.effectiveOn, Number(rateForm.interestRate))
      : null;
  const currentMonthly = rateForm?.loan.monthlyPayment
    ? Number(rateForm.loan.monthlyPayment)
    : null;

  if (loading) {
    return (
      <View style={s.center}>
        <ActivityIndicator color="#4f46e5" size="large" />
      </View>
    );
  }

  return (
    <View style={s.root}>
      <ScrollView
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {error && <Notice tone="error">{error}</Notice>}

        <View style={s.kpiRow}>
          <Card style={s.kpi}>
            <Text style={s.kpiLabel}>借入残高合計</Text>
            <Text style={[s.kpiValue, { color: "#dc2626" }]}>{yen(totalRemaining)}</Text>
          </Card>
          <Card style={s.kpi}>
            <Text style={s.kpiLabel}>借入総額</Text>
            <Text style={s.kpiValue}>{yen(totalBorrowed)}</Text>
          </Card>
        </View>

        {scheduleData.length > 0 && (
          <Card>
            <SectionTitle note="今日以降の残高は償還スケジュールからの予測です。">
              返済スケジュール
            </SectionTitle>
            <View style={s.switchRow}>
              <Text style={s.switchLabel}>金利を重ねて表示</Text>
              <Switch value={showRates} onValueChange={setShowRates} />
            </View>
            <LoanScheduleChart loans={loans} points={scheduleData} showRates={showRates} />
            {showRates && (
              <Text style={s.muted}>
                金利は右軸。今日以降の破線は、登録済みの将来の改定と「これまでと同じ間隔・同じ幅で改定が続いたら」
                という前提で履歴から外挿した予測です（金利変更履歴が 2
                件以上あるローンのみ予測します）。
              </Text>
            )}
            {activeLoans.map((l) => {
              const i = loans.indexOf(l);
              return (
                <View key={l.id} style={s.progressRow}>
                  <View style={[s.dot, { backgroundColor: LOAN_COLORS[i % LOAN_COLORS.length] }]} />
                  <Text style={s.progressName} numberOfLines={1}>
                    {l.lenderName}
                  </Text>
                  <Text style={s.muted}>返済期限 {l.repaymentDate.slice(0, 7)}</Text>
                  <Text style={s.muted}>{progressOf(l)}%</Text>
                </View>
              );
            })}
          </Card>
        )}

        <Button
          label="借入追加"
          onPress={() => {
            setSheetError(null);
            setNewLoan(BLANK_LOAN);
          }}
          style={{ marginBottom: 12 }}
        />

        {loans.length === 0 ? (
          <EmptyText>🏦 借入金の記録がありません。</EmptyText>
        ) : (
          loans.map((l, i) => {
            const pending = pendingRateChange(l);
            const cmp = expanded[`rate-${l.id}`] ? buildRateComparison(l) : null;
            const progress = progressOf(l);
            const color = LOAN_COLORS[i % LOAN_COLORS.length];
            return (
              <Card key={l.id}>
                <View style={s.loanHead}>
                  <View style={[s.dot, { backgroundColor: color }]} />
                  <Text style={s.loanName} numberOfLines={1}>
                    {l.lenderName}
                  </Text>
                  <Text style={[s.badge, l.status === "active" ? s.badgeActive : s.badgeDone]}>
                    {l.status === "active" ? "返済中" : "完済"}
                  </Text>
                  <Text style={[s.badge, s.badgeType]}>
                    {LOAN_TYPE_LABEL[l.loanType] ?? l.loanType}
                  </Text>
                </View>
                <Text style={s.detail}>
                  借入額: {yen(Number(l.amount))} ・ 金利: {ratePercent(l.interestRate).toFixed(2)}%
                </Text>
                <Text style={s.detail}>
                  残高: <Text style={s.remaining}>{yen(Number(l.remainingAmount))}</Text> ・
                  支払い完了年月: {l.repaymentDate.slice(0, 7)}
                </Text>
                {l.monthlyPayment && (
                  <Text style={s.linked}>
                    月々の返済額: {yen(Number(l.monthlyPayment))}
                    {l.monthlyPaymentIsManual ? "（実額）" : "（計算値）"}
                  </Text>
                )}
                {Number(l.residualValue ?? 0) > 0 && (
                  <Text style={s.linked}>残価: {yen(Number(l.residualValue))}（最終回に一括）</Text>
                )}
                {l.linkedAccount && (
                  <Text style={s.linked}>
                    予算連携先:{" "}
                    {accountLabel(
                      l.linkedAccount.code,
                      `${l.linkedAccount.code} ${l.linkedAccount.name}`,
                    )}
                    （自動加算）
                  </Text>
                )}

                {/* 金利が改定されたが、改定後の実額返済額がまだ入力されていない */}
                {pending && (
                  <View style={s.pendingBox}>
                    <Text style={s.pendingTitle}>
                      {pending.effectiveOn.slice(0, 7)} に金利が{" "}
                      {ratePercent(pending.interestRate).toFixed(2)}%
                      へ改定されました。改定後の返済額を入力してください
                    </Text>
                    <Text style={s.pendingText}>
                      現在は改定前の{l.monthlyPayment ? yen(Number(l.monthlyPayment)) : "—"}
                      で計算中です。
                      {pending.calculatedMonthlyPayment &&
                        `計算上の目安は ${yen(Number(pending.calculatedMonthlyPayment))} ですが、`}
                      5
                      年ルールのローンでは返済額が据え置かれるため、金融機関の通知額を入力してください。
                    </Text>
                    <VariableRateHelp />
                    <Button
                      small
                      label="入力する"
                      onPress={() => {
                        setSheetError(null);
                        setPendingForm({
                          loan: l,
                          changeId: pending.id,
                          monthlyPayment: pending.calculatedMonthlyPayment ?? "",
                        });
                      }}
                      style={{ alignSelf: "flex-start", marginTop: 6 }}
                    />
                  </View>
                )}

                {Number(l.amount) > 0 && (
                  <View style={s.progressWrap}>
                    <View style={s.progressTrack}>
                      <View
                        style={[s.progressFill, { width: `${progress}%`, backgroundColor: color }]}
                      />
                    </View>
                    <Text style={s.muted}>{progress}% 返済済</Text>
                  </View>
                )}

                <View style={s.actions}>
                  <Button
                    small
                    variant="secondary"
                    label="編集"
                    onPress={() => {
                      setSheetError(null);
                      setEditForm({
                        loan: l,
                        repaymentDate: l.repaymentDate.slice(0, 10),
                        monthlyPayment: l.monthlyPayment ?? "",
                        residualValue: l.residualValue ?? "",
                        linkedAccountCode: l.linkedAccount?.code ?? "",
                      });
                    }}
                  />
                  <Button
                    small
                    variant="secondary"
                    label="金利変更"
                    onPress={() => {
                      setSheetError(null);
                      setRateForm({
                        loan: l,
                        effectiveOn: today(),
                        interestRate: l.interestRate,
                        monthlyPayment: "",
                        note: "",
                      });
                    }}
                  />
                  {l.status === "active" && (
                    <Button
                      small
                      label="返済登録"
                      onPress={() => {
                        setSheetError(null);
                        setPayForm({ loan: l, principal: "", interest: "0", repaidOn: today() });
                      }}
                    />
                  )}
                </View>

                {l.repayments.length > 0 && (
                  <>
                    <TouchableOpacity onPress={() => toggle(`pay-${l.id}`)}>
                      <Text style={s.expand}>
                        {expanded[`pay-${l.id}`] ? "▼" : "▶"} 返済履歴 ({l.repayments.length}件)
                      </Text>
                    </TouchableOpacity>
                    {expanded[`pay-${l.id}`] &&
                      l.repayments.map((r) => (
                        <Text key={r.id} style={s.historyRow}>
                          {r.repaidOn.slice(0, 10)} 元金 {yen(Number(r.principal))} ・ 利息{" "}
                          {yen(Number(r.interest))} ・ 合計 {yen(Number(r.totalAmount))}
                        </Text>
                      ))}
                  </>
                )}

                {l.rateChanges.length > 0 && (
                  <>
                    <TouchableOpacity onPress={() => toggle(`rate-${l.id}`)}>
                      <Text style={[s.expand, { color: "#b45309" }]}>
                        {expanded[`rate-${l.id}`] ? "▼" : "▶"} 金利変更履歴 ({l.rateChanges.length}
                        件) と 変動前後の比較
                      </Text>
                    </TouchableOpacity>
                    {expanded[`rate-${l.id}`] && (
                      <View>
                        {l.rateChanges.map((c) => {
                          const diff = ratePercent(c.interestRate) - ratePercent(c.previousRate);
                          return (
                            <View key={c.id} style={s.rateRow}>
                              <Text style={s.historyRow}>
                                {c.effectiveOn.slice(0, 10)} ・{" "}
                                {ratePercent(c.previousRate).toFixed(2)}% →{" "}
                                <Text style={s.bold}>
                                  {ratePercent(c.interestRate).toFixed(2)}%
                                </Text>{" "}
                                <Text
                                  style={{
                                    color: diff > 0 ? "#dc2626" : diff < 0 ? "#16a34a" : "#94a3b8",
                                  }}
                                >
                                  ({diff > 0 ? "+" : ""}
                                  {diff.toFixed(2)}pt)
                                </Text>
                              </Text>
                              <Text style={s.historyRow}>
                                返済額{" "}
                                {c.previousMonthlyPayment
                                  ? yen(Number(c.previousMonthlyPayment))
                                  : "—"}{" "}
                                → {c.monthlyPayment ? yen(Number(c.monthlyPayment)) : "未入力"}
                                {c.calculatedMonthlyPayment
                                  ? `（計算上の目安 ${yen(Number(c.calculatedMonthlyPayment))}）`
                                  : ""}
                                {c.note ? ` ・ ${c.note}` : ""}
                              </Text>
                              {!c.monthlyPayment && (
                                <Button
                                  small
                                  variant="secondary"
                                  label="改定後の返済額を入力"
                                  onPress={() => {
                                    setSheetError(null);
                                    setPendingForm({
                                      loan: l,
                                      changeId: c.id,
                                      monthlyPayment: c.calculatedMonthlyPayment ?? "",
                                    });
                                  }}
                                  style={{ alignSelf: "flex-start" }}
                                />
                              )}
                            </View>
                          );
                        })}
                        {cmp && (
                          <View style={{ marginTop: 8 }}>
                            <View style={s.cmpGrid}>
                              <View style={s.cmpCell}>
                                <Text style={s.cmpLabel}>総支払額（変動前）</Text>
                                <Text style={s.cmpValue}>{yen(cmp.beforeTotal)}</Text>
                              </View>
                              <View style={s.cmpCell}>
                                <Text style={s.cmpLabel}>総支払額（変動後）</Text>
                                <Text style={s.cmpValue}>{yen(cmp.afterTotal)}</Text>
                              </View>
                              <View style={s.cmpCell}>
                                <Text style={s.cmpLabel}>総利息（変動前 → 後）</Text>
                                <Text style={s.cmpValue}>
                                  {yen(cmp.beforeInterest)} → {yen(cmp.afterInterest)}
                                </Text>
                              </View>
                              <View
                                style={[
                                  s.cmpCell,
                                  {
                                    backgroundColor:
                                      cmp.afterTotal > cmp.beforeTotal ? "#fef2f2" : "#f0fdf4",
                                  },
                                ]}
                              >
                                <Text style={s.cmpLabel}>総支払額の差</Text>
                                <Text
                                  style={[
                                    s.cmpValue,
                                    {
                                      color:
                                        cmp.afterTotal > cmp.beforeTotal ? "#dc2626" : "#16a34a",
                                    },
                                  ]}
                                >
                                  {cmp.afterTotal > cmp.beforeTotal ? "+" : ""}
                                  {yen(cmp.afterTotal - cmp.beforeTotal)}
                                </Text>
                              </View>
                            </View>
                            <ComparisonChart points={cmp.points} />
                            <Text style={s.muted}>
                              借入額 {yen(Number(l.amount))}{" "}
                              を借入日〜支払い完了年月で償還した場合の残高推移。
                              {l.monthlyPayment
                                ? `月々の返済額は${l.monthlyPaymentIsManual ? "入力された実額" : "登録済みの金額"}で据え置き（金利上昇分は元本充当が減ります）。`
                                : "金利変更月に残高と残回数から月額を再計算しています。"}
                            </Text>
                          </View>
                        )}
                      </View>
                    )}
                  </>
                )}
              </Card>
            );
          })
        )}
      </ScrollView>

      {/* ── 借入追加 ── */}
      <SheetModal
        visible={newLoan !== null}
        title="借入追加"
        onClose={() => setNewLoan(null)}
        footer={
          <Button
            label="保存"
            disabled={
              !newLoan?.lenderName ||
              !newLoan?.amount ||
              !newLoan?.borrowedOn ||
              !newLoan?.repaymentDate
            }
            onPress={() =>
              newLoan &&
              submit(
                () =>
                  postLoan({
                    lenderName: newLoan.lenderName,
                    amount: Number(newLoan.amount),
                    interestRate: Number(newLoan.interestRate),
                    borrowedOn: newLoan.borrowedOn,
                    repaymentDate: newLoan.repaymentDate,
                    note: newLoan.note || undefined,
                    loanType: newLoan.loanType,
                    linkedAccountCode: newLoan.linkedAccountCode || undefined,
                    monthlyPayment: newLoan.monthlyPayment
                      ? Number(newLoan.monthlyPayment)
                      : undefined,
                  }),
                () => setNewLoan(null),
              )
            }
          />
        }
      >
        {newLoan && (
          <>
            <Field label="借入先 *">
              <Input
                value={newLoan.lenderName}
                onChangeText={(lenderName) => setNewLoan({ ...newLoan, lenderName })}
              />
            </Field>
            <Field label="借入金額（円）*">
              <Input
                keyboardType="number-pad"
                value={newLoan.amount}
                onChangeText={(amount) => setNewLoan({ ...newLoan, amount })}
              />
            </Field>
            <Field label="年利率（例: 0.03）">
              <Input
                keyboardType="decimal-pad"
                value={newLoan.interestRate}
                onChangeText={(interestRate) => setNewLoan({ ...newLoan, interestRate })}
              />
            </Field>
            <Field label="借入日 *（YYYY-MM-DD）">
              <Input
                value={newLoan.borrowedOn}
                onChangeText={(borrowedOn) => setNewLoan({ ...newLoan, borrowedOn })}
              />
            </Field>
            <Field label="支払い完了年月（完済予定日）*（YYYY-MM-DD）">
              <Input
                value={newLoan.repaymentDate}
                onChangeText={(repaymentDate) => setNewLoan({ ...newLoan, repaymentDate })}
              />
            </Field>
            <Field label="借入種別">
              <Pills
                scroll={false}
                options={LOAN_TYPES}
                value={newLoan.loanType}
                onChange={(loanType) => setNewLoan({ ...newLoan, loanType })}
              />
            </Field>
            <Field label="予算連携先科目（例: 家賃・借入返済）">
              <TouchableOpacity style={s.picker} onPress={() => setPicking("new")}>
                <Text style={s.pickerText}>
                  {accountLabel(newLoan.linkedAccountCode, "選択してください")}
                </Text>
              </TouchableOpacity>
            </Field>
            <Field label="月々の返済額（円）">
              <Input
                keyboardType="number-pad"
                value={newLoan.monthlyPayment}
                onChangeText={(monthlyPayment) => setNewLoan({ ...newLoan, monthlyPayment })}
              />
              <Text style={s.muted}>
                支払い完了年月まで、連携先科目の予算に毎月自動加算されます。
              </Text>
            </Field>
            <Field label="備考">
              <Input
                value={newLoan.note}
                onChangeText={(note) => setNewLoan({ ...newLoan, note })}
              />
            </Field>
            {sheetError && <Notice tone="error">{sheetError}</Notice>}
          </>
        )}
      </SheetModal>

      {/* ── 借入条件の編集 ── */}
      <SheetModal
        visible={editForm !== null}
        title="借入条件の編集"
        onClose={() => setEditForm(null)}
        footer={
          <Button
            label="保存"
            disabled={!editForm?.repaymentDate}
            onPress={() =>
              editForm &&
              submit(
                () =>
                  patchLoan(editForm.loan.id, {
                    repaymentDate: editForm.repaymentDate,
                    monthlyPayment: editForm.monthlyPayment
                      ? Number(editForm.monthlyPayment)
                      : null,
                    residualValue: editForm.residualValue ? Number(editForm.residualValue) : null,
                    linkedAccountCode: editForm.linkedAccountCode || null,
                  }),
                () => setEditForm(null),
              )
            }
          />
        }
      >
        {editForm && (
          <>
            <Field label="支払い完了年月（完済予定日）*（YYYY-MM-DD）">
              <Input
                value={editForm.repaymentDate}
                onChangeText={(repaymentDate) => setEditForm({ ...editForm, repaymentDate })}
              />
            </Field>
            <Field label="予算連携先科目（例: 家賃）">
              <TouchableOpacity style={s.picker} onPress={() => setPicking("edit")}>
                <Text style={s.pickerText}>
                  {accountLabel(editForm.linkedAccountCode, "連携なし")}
                </Text>
              </TouchableOpacity>
            </Field>
            <Field label="月々の返済額（円）">
              <Input
                keyboardType="number-pad"
                value={editForm.monthlyPayment}
                onChangeText={(monthlyPayment) => setEditForm({ ...editForm, monthlyPayment })}
              />
              <Text style={s.muted}>
                連携先科目を設定すると、支払い完了年月まで予算に毎月自動加算されます。入力した金額は実額として扱われ、
                金利改定や資産の編集では上書きされません。
              </Text>
              <VariableRateHelp />
            </Field>
            <Field label="残価（円）">
              <Input
                keyboardType="number-pad"
                value={editForm.residualValue}
                placeholder="残価設定ローンのみ"
                onChangeText={(residualValue) => setEditForm({ ...editForm, residualValue })}
              />
              <Text style={s.muted}>
                残価設定ローン（カーローン等）で最終回に一括して支払う据置額。入力すると毎月はこの額を除いた分だけを償却し、
                最終回に残価が残る計算になります。
              </Text>
            </Field>
            {sheetError && <Notice tone="error">{sheetError}</Notice>}
          </>
        )}
      </SheetModal>

      {/* ── 金利変更の登録 ── */}
      <SheetModal
        visible={rateForm !== null}
        title="金利変更の登録"
        subtitle="変更前の金利は履歴として残り、変動前後の返済スケジュールを比較できます。"
        onClose={() => setRateForm(null)}
        footer={
          <Button
            label="登録"
            disabled={rateForm?.interestRate === ""}
            onPress={() =>
              rateForm &&
              submit(
                () =>
                  postLoanRateChange(rateForm.loan.id, {
                    effectiveOn: rateForm.effectiveOn,
                    interestRate: Number(rateForm.interestRate),
                    monthlyPayment: rateForm.monthlyPayment
                      ? Number(rateForm.monthlyPayment)
                      : null,
                    note: rateForm.note || undefined,
                  }),
                () => setRateForm(null),
              )
            }
          />
        }
      >
        {rateForm && (
          <>
            <Field label="金利変更日（適用開始）（YYYY-MM-DD）">
              <Input
                value={rateForm.effectiveOn}
                onChangeText={(effectiveOn) => setRateForm({ ...rateForm, effectiveOn })}
              />
            </Field>
            <Field label="変更後の年利率（例: 0.03 = 3%）">
              <Input
                keyboardType="decimal-pad"
                value={rateForm.interestRate}
                onChangeText={(interestRate) => setRateForm({ ...rateForm, interestRate })}
              />
              <Text style={s.muted}>
                現在: {ratePercent(rateForm.interestRate || 0).toFixed(2)}%
              </Text>
            </Field>
            <Field label="改定後の月々の返済額（実額）">
              <Input
                keyboardType="number-pad"
                value={rateForm.monthlyPayment}
                placeholder={rateRef ? `参考: ${rateRef.monthly}` : "金融機関の通知額"}
                onChangeText={(monthlyPayment) => setRateForm({ ...rateForm, monthlyPayment })}
              />
              <Text style={s.muted}>
                金融機関から通知された金額を入力してください。入力するとこの額で残高・予算が再計算されます。
              </Text>
              {currentMonthly !== null && (
                <Text style={s.muted}>現在の返済額: {yen(currentMonthly)}</Text>
              )}
              {rateRef && (
                <Text style={s.muted}>
                  計算上の目安: {yen(rateRef.monthly)}（残高 {yen(rateRef.balance)} ÷ 残り{" "}
                  {rateRef.remainingMonths}回）
                </Text>
              )}
              {rateRef && currentMonthly !== null && currentMonthly !== rateRef.monthly && (
                <Notice tone="warn">
                  5 年ルールのローンなら、金利が変わっても返済額は{yen(currentMonthly)}
                  のまま据え置かれます。通知が届いていなければ空欄のままで構いません（後から入力できます）。
                </Notice>
              )}
              <VariableRateHelp />
            </Field>
            <Field label="メモ">
              <Input
                value={rateForm.note}
                placeholder="例: 変動金利見直し"
                onChangeText={(note) => setRateForm({ ...rateForm, note })}
              />
            </Field>
            {sheetError && <Notice tone="error">{sheetError}</Notice>}
          </>
        )}
      </SheetModal>

      {/* ── 金利改定後の実額を後から入力 ── */}
      <SheetModal
        visible={pendingForm !== null}
        title="改定後の返済額を入力"
        subtitle="金融機関から通知された、改定後の月々の返済額を入力してください。以降の残高・予算がこの額で計算されます。"
        onClose={() => setPendingForm(null)}
        footer={
          <Button
            label="反映"
            disabled={pendingForm?.monthlyPayment === ""}
            onPress={() =>
              pendingForm &&
              submit(
                () =>
                  patchLoanRateChange(
                    pendingForm.loan.id,
                    pendingForm.changeId,
                    Number(pendingForm.monthlyPayment),
                  ),
                () => setPendingForm(null),
              )
            }
          />
        }
      >
        {pendingForm && (
          <>
            <Input
              autoFocus
              keyboardType="number-pad"
              value={pendingForm.monthlyPayment}
              onChangeText={(monthlyPayment) => setPendingForm({ ...pendingForm, monthlyPayment })}
            />
            <VariableRateHelp />
            {sheetError && <Notice tone="error">{sheetError}</Notice>}
          </>
        )}
      </SheetModal>

      {/* ── 返済登録 ── */}
      <SheetModal
        visible={payForm !== null}
        title="返済登録"
        subtitle={payForm?.loan.lenderName}
        onClose={() => setPayForm(null)}
        footer={
          <Button
            label="登録"
            disabled={!payForm?.principal || !payForm?.repaidOn}
            onPress={() =>
              payForm &&
              submit(
                () =>
                  repayLoan(payForm.loan.id, {
                    repaidOn: payForm.repaidOn,
                    principal: Number(payForm.principal),
                    interest: Number(payForm.interest || 0),
                  }),
                () => setPayForm(null),
              )
            }
          />
        }
      >
        {payForm && (
          <>
            <Field label="返済日 *（YYYY-MM-DD）">
              <Input
                value={payForm.repaidOn}
                onChangeText={(repaidOn) => setPayForm({ ...payForm, repaidOn })}
              />
            </Field>
            <Field label="元金（円）*">
              <Input
                keyboardType="number-pad"
                value={payForm.principal}
                onChangeText={(principal) => setPayForm({ ...payForm, principal })}
              />
            </Field>
            <Field label="利息（円）">
              <Input
                keyboardType="number-pad"
                value={payForm.interest}
                onChangeText={(interest) => setPayForm({ ...payForm, interest })}
              />
            </Field>
            {sheetError && <Notice tone="error">{sheetError}</Notice>}
          </>
        )}
      </SheetModal>

      <AccountPickerModal
        visible={picking !== null}
        accounts={expenseAccounts}
        title="予算連携先科目"
        clearLabel={picking === "edit" ? "連携なし" : "選択しない"}
        currentId={
          accounts.find(
            (a) =>
              a.code ===
              (picking === "edit" ? editForm?.linkedAccountCode : newLoan?.linkedAccountCode),
          )?.id ?? null
        }
        onSelect={(a) => {
          const code = a?.code ?? "";
          if (picking === "edit" && editForm) setEditForm({ ...editForm, linkedAccountCode: code });
          if (picking === "new" && newLoan) setNewLoan({ ...newLoan, linkedAccountCode: code });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  content: { padding: 14, paddingBottom: 32 },
  kpiRow: { flexDirection: "row", gap: 10 },
  kpi: { flex: 1 },
  kpiLabel: { fontSize: 11, color: "#64748b", marginBottom: 4 },
  kpiValue: { fontSize: 17, fontWeight: "700", color: "#1e293b" },
  switchRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  switchLabel: { fontSize: 12, color: "#475569" },
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16, marginTop: 3 },
  progressRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 6 },
  progressName: { fontSize: 12, color: "#475569", flex: 1 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  loanHead: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  loanName: { fontSize: 15, fontWeight: "700", color: "#1e293b", flexShrink: 1 },
  badge: {
    fontSize: 10,
    paddingHorizontal: 6,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  badgeActive: { backgroundColor: "#fef9c3", color: "#a16207" },
  badgeDone: { backgroundColor: "#dcfce7", color: "#15803d" },
  badgeType: { backgroundColor: "#e0e7ff", color: "#4338ca" },
  detail: { fontSize: 12, color: "#475569", marginTop: 2 },
  remaining: { color: "#dc2626", fontWeight: "700" },
  linked: { fontSize: 11, color: "#4f46e5", marginTop: 3 },
  pendingBox: {
    borderWidth: 1,
    borderColor: "#fde68a",
    backgroundColor: "#fffbeb",
    borderRadius: 8,
    padding: 10,
    marginTop: 8,
  },
  pendingTitle: { fontSize: 12, fontWeight: "700", color: "#92400e" },
  pendingText: { fontSize: 11, color: "#b45309", marginTop: 3, lineHeight: 16 },
  progressWrap: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8 },
  progressTrack: {
    width: 140,
    height: 6,
    backgroundColor: "#f1f5f9",
    borderRadius: 3,
    overflow: "hidden",
  },
  progressFill: { height: 6, borderRadius: 3 },
  actions: { flexDirection: "row", gap: 8, marginTop: 10, flexWrap: "wrap" },
  expand: { fontSize: 12, color: "#4f46e5", marginTop: 10 },
  historyRow: { fontSize: 11, color: "#475569", marginTop: 3 },
  rateRow: { borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingVertical: 6, gap: 4 },
  cmpGrid: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginBottom: 8 },
  cmpCell: { width: "48%", backgroundColor: "#f8fafc", borderRadius: 8, padding: 8 },
  cmpLabel: { fontSize: 10, color: "#64748b" },
  cmpValue: { fontSize: 12, fontWeight: "700", color: "#334155", marginTop: 2 },
  helpLink: { fontSize: 11, color: "#64748b", marginTop: 6 },
  helpBox: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 10,
    marginTop: 6,
    gap: 6,
    backgroundColor: "#fff",
  },
  helpText: { fontSize: 11, color: "#475569", lineHeight: 17 },
  bold: { fontWeight: "700" },
  picker: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  pickerText: { fontSize: 14, color: "#1e293b" },
});
