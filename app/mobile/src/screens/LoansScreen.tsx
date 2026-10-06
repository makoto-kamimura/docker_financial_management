// 借入金管理（web 版 /loans と同じ内容・同じ並び。資産管理と同じく、日付つきの合計 → 合計のグラフ →
// ローンごとの残高と金利のグラフ → 一覧）。残高の推移・金利予測・変動前後の比較・金利改定時の参考月額は
// web と共有する shared/loan-schedule.ts で計算する（同じ入力なら同じ数字になる）。
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import Svg, { Polyline } from "react-native-svg";
import {
  fetchAccounts,
  fetchLoans,
  fetchPersonalAssets,
  patchLoan,
  patchLoanRateChange,
  postLoan,
  postLoanRateChange,
  repayLoan,
  type Account,
  type Loan,
  type PersonalAsset,
  type ViewMode,
} from "../api";
import { AccountPickerModal } from "../components/CategoryPickerModal";
import { AssetValueChart, SERIES_COLORS } from "../components/AssetValueChart";
import {
  Button,
  Card,
  EmptyText,
  Field,
  Input,
  Lead,
  Notice,
  Pills,
  SectionTitle,
  SheetModal,
} from "../components/ui";
import { yen } from "../format";
import { displayName } from "../shared/display-name";
import { LOANS_HELP } from "../shared/help-texts";
import {
  LOAN_TYPE_LABEL,
  LOAN_TYPES,
  PERSONAL_ASSET_CATEGORY_LABEL,
  type PersonalAssetCategory,
} from "../shared/labels";
import { asOfDateLabel } from "../shared/asset-valuation";
import {
  buildRateComparison,
  loanTrendSeries,
  pendingPaymentChoices,
  pendingRateChange,
  ratePercent,
  referenceMonthly,
  type LoanRateChange,
  type PaymentChoice,
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
  residualValue: string;
  /** この借入で買った資産（なし・その場で作る・既存から選ぶ） */
  assetMode: "none" | "new" | "link";
  assetName: string;
  assetCategory: PersonalAssetCategory;
  assetCost: string;
  assetValue: string;
  assetId: number | null;
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
  residualValue: "",
  assetMode: "none",
  assetName: "",
  assetCategory: "OTHER",
  assetCost: "",
  assetValue: "",
  assetId: null,
};
const ASSET_MODES = [
  { value: "none" as const, label: "なし" },
  { value: "new" as const, label: "新しく作る" },
  { value: "link" as const, label: "既存から選ぶ" },
];
const CATEGORY_OPTIONS = (
  Object.keys(PERSONAL_ASSET_CATEGORY_LABEL) as PersonalAssetCategory[]
).map((value) => ({ value, label: PERSONAL_ASSET_CATEGORY_LABEL[value] }));
/** ローンの種別から、その場で作る資産の種別の既定を決める（住宅→建物、カー→車） */
const assetCategoryForLoanType = (loanType: string): PersonalAssetCategory =>
  loanType === "housing" ? "BUILDING" : loanType === "car" ? "VEHICLE" : "OTHER";

/** 新しい借入の「この借入で買った資産」を API の形に直す（取得価格の既定は借入額、評価額の既定は取得価格） */
function assetPayload(f: NewLoanForm) {
  if (f.assetMode === "link")
    return f.assetId !== null ? { mode: "link" as const, assetId: f.assetId } : undefined;
  if (f.assetMode !== "new") return undefined;
  const cost = f.assetCost ? Number(f.assetCost) : Number(f.amount);
  return {
    mode: "new" as const,
    name: f.assetName || f.lenderName,
    category: f.assetCategory,
    acquiredOn: f.borrowedOn || undefined,
    acquisitionCost: cost,
    currentValue: f.assetValue ? Number(f.assetValue) : cost,
  };
}

type Props = { viewMode: ViewMode };

export function LoansScreen({ viewMode }: Props) {
  const [loans, setLoans] = useState<Loan[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const [newLoan, setNewLoan] = useState<NewLoanForm | null>(null);
  // ひも付ける資産の候補（ローンの無い資産）
  const [assets, setAssets] = useState<PersonalAsset[]>([]);
  const [editForm, setEditForm] = useState<{
    loan: Loan;
    amount: string;
    borrowedOn: string;
    interestRate: string;
    /** 金利変更の履歴があるローンは、金利は「金利変更」で直す */
    rateEditable: boolean;
    assetId: number | null;
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
  // 改定後の実額を後から入力するフォーム。据え置き（5 年ルール）・再計算された額・通知額の入力から選ぶ
  const [pendingForm, setPendingForm] = useState<{
    loan: Loan;
    changeId: number;
    monthlyPayment: string;
    choices: PaymentChoice[];
    choice: PaymentChoice["key"];
  } | null>(null);
  // 既定は先頭の選択肢（据え置きがあれば据え置き）
  const openPending = (
    loan: Loan,
    change: Pick<LoanRateChange, "id" | "previousMonthlyPayment" | "calculatedMonthlyPayment">,
  ) => {
    const choices = pendingPaymentChoices(loan, change);
    const first = choices[0];
    setSheetError(null);
    setPendingForm({
      loan,
      changeId: change.id,
      monthlyPayment: first.amount !== null ? String(first.amount) : "",
      choices,
      choice: first.key,
    });
  };
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
      const [ls, accs, pa] = await Promise.all([
        fetchLoans(),
        fetchAccounts(),
        fetchPersonalAssets().catch(() => []),
      ]);
      setAssets(pa);
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

  const trend = useMemo(() => (loans.length > 0 ? loanTrendSeries(loans) : null), [loans]);
  // いつ時点の残高か（資産管理と同じ書き方）
  const asOf = asOfDateLabel(new Date());
  const activeLoans = loans.filter((l) => l.status === "active");
  const totalBorrowed = loans.reduce((sum, l) => sum + Number(l.amount), 0);
  const totalRemaining = activeLoans.reduce((sum, l) => sum + Number(l.remainingAmount), 0);
  // 予算連携先の候補: 費用の科目と、負債の科目（資産のローンは負債の科目に上乗せしていた）
  const expenseAccounts = accounts.filter(
    (a) => a.category === "EXPENSE" || a.category === "LIABILITY",
  );
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
        <Lead>{LOANS_HELP.page}</Lead>

        {/* 改定後の返済額が未入力の借入があれば、上で 1 行だけ知らせる */}
        {loans.some((l) => pendingRateChange(l) !== null) && (
          <Notice tone="warn">
            金利が改定され、改定後の返済額が未入力の借入があります（
            {loans
              .filter((l) => pendingRateChange(l) !== null)
              .map((l) => l.lenderName)
              .join("、")}
            ）。下の一覧の「入力する」から反映してください。
          </Notice>
        )}

        {/* 借入残高の推移（web 版 LoanTrendCharts と同じ。合計とローンごとの残高・金利） */}
        {trend && trend.months.length > 0 && (
          <Card>
            <SectionTitle note={LOANS_HELP.schedule}>借入残高の推移</SectionTitle>
            <Text style={s.muted}>借入残高合計（{asOf}）</Text>
            <Text style={s.totalValue}>{yen(totalRemaining)}</Text>
            <Text style={s.muted}>借入総額 {yen(totalBorrowed)}</Text>
            <AssetValueChart
              months={trend.months}
              currentKey={trend.currentKey}
              series={[
                { key: "total", label: "合計", color: SERIES_COLORS[0], values: trend.total },
              ]}
              height={180}
            />
            <Text style={s.subTitle}>ローンごとの推移</Text>
            {loans.map((l) => {
              const row = trend.loans.find((r) => r.id === l.id);
              if (!row) return null;
              return (
                <View key={l.id} style={s.trendItem}>
                  <View style={s.loanHead}>
                    <Text style={[s.badge, s.badgeType]}>
                      {LOAN_TYPE_LABEL[l.loanType] ?? l.loanType}
                    </Text>
                    <Text style={s.trendName} numberOfLines={1}>
                      {l.lenderName}
                    </Text>
                    <Text style={[s.badge, l.status === "active" ? s.badgeActive : s.badgeDone]}>
                      {l.status === "active" ? "返済中" : "完済"}
                    </Text>
                  </View>
                  <Text style={s.muted}>
                    {asOf}の残高 {yen(Number(l.remainingAmount))} ・ 完済予定{" "}
                    {l.repaymentDate.slice(0, 7)} ・ {progressOf(l)}% 返済済
                  </Text>
                  <Text style={s.chartLabel}>残高</Text>
                  <AssetValueChart
                    months={trend.months}
                    currentKey={trend.currentKey}
                    series={[
                      {
                        key: `b${l.id}`,
                        label: "残高",
                        color: SERIES_COLORS[0],
                        values: row.balance,
                      },
                    ]}
                    height={110}
                  />
                  <Text style={s.chartLabel}>
                    金利（今の金利 {ratePercent(l.interestRate).toFixed(3)}%）
                  </Text>
                  <AssetValueChart
                    months={trend.months}
                    currentKey={trend.currentKey}
                    series={[
                      { key: `r${l.id}`, label: "金利", color: SERIES_COLORS[1], values: row.rate },
                    ]}
                    height={80}
                    stepped
                    formatValue={(v) => `${v.toFixed(3)}%`}
                    formatAxis={(v) => `${v.toFixed(2)}%`}
                  />
                </View>
              );
            })}
          </Card>
        )}

        {/* 借入金（資産管理の「実物資産」と同じく 1 枚のカードにまとめ、ローンは枠線つきのブロックで並べる） */}
        <Card>
          <SectionTitle
            note={
              LOANS_HELP.list +
              (loans.length > 0
                ? `\n${asOf}の残高合計: ${yen(totalRemaining)} ・ ${loans.length} 件`
                : "")
            }
          >
            借入金（住宅ローン・カーローンなど）
          </SectionTitle>
          <Button
            small
            label="借入追加"
            onPress={() => {
              setSheetError(null);
              setNewLoan(BLANK_LOAN);
            }}
            style={{ alignSelf: "flex-start", marginBottom: 8 }}
          />

          {loans.length === 0 ? (
            <EmptyText>🏦 {LOANS_HELP.empty}</EmptyText>
          ) : (
            loans.map((l, i) => {
              const pending = pendingRateChange(l);
              const cmp = expanded[`rate-${l.id}`] ? buildRateComparison(l) : null;
              const progress = progressOf(l);
              return (
                <View key={l.id} style={s.loanBlock}>
                  {/* 金利が改定されたが、改定後の実額返済額がまだ入力されていない（カードのいちばん上に出す） */}
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
                          `計算上の目安は ${yen(Number(pending.calculatedMonthlyPayment))} です。`}
                        5
                        年ルールなら「据え置き」を選ぶだけで反映できます（通知額が違うときは入力してください）。
                      </Text>
                      <VariableRateHelp />
                      <Button
                        small
                        label="入力する"
                        onPress={() => {
                          setSheetError(null);
                          openPending(l, pending);
                        }}
                        style={{ alignSelf: "flex-start", marginTop: 6 }}
                      />
                    </View>
                  )}
                  {/* 資産管理の一覧と同じ並び: 左に名前と条件、右に日付つきの残高 */}
                  <View style={s.loanTop}>
                    <View style={{ flex: 1 }}>
                      <View style={s.loanHead}>
                        <Text style={[s.badge, s.badgeType]}>
                          {LOAN_TYPE_LABEL[l.loanType] ?? l.loanType}
                        </Text>
                        <Text style={s.loanName} numberOfLines={1}>
                          {l.lenderName}
                        </Text>
                        <Text
                          style={[s.badge, l.status === "active" ? s.badgeActive : s.badgeDone]}
                        >
                          {l.status === "active" ? "返済中" : "完済"}
                        </Text>
                      </View>
                      <Text style={s.detail}>
                        借入額: {yen(Number(l.amount))} ・ 金利:{" "}
                        {ratePercent(l.interestRate).toFixed(3)}% ・ 完済予定:{" "}
                        {l.repaymentDate.slice(0, 7)}
                      </Text>
                      {l.personalAsset && (
                        <Text style={s.muted}>
                          この借入で買った資産: {l.personalAsset.name}（資産管理で見る）
                        </Text>
                      )}
                    </View>
                    <View style={s.balanceBox}>
                      <Text style={s.balanceLabel}>{asOf}の残高</Text>
                      <Text style={s.remaining}>{yen(Number(l.remainingAmount))}</Text>
                    </View>
                  </View>
                  {l.monthlyPayment && (
                    <Text style={s.linked}>
                      月々の返済額: {yen(Number(l.monthlyPayment))}
                      {l.monthlyPaymentIsManual ? "（実額）" : "（計算値）"}
                    </Text>
                  )}
                  {Number(l.residualValue ?? 0) > 0 && (
                    <Text style={s.linked}>
                      残価: {yen(Number(l.residualValue))}（最終回に一括）
                    </Text>
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

                  {Number(l.amount) > 0 && (
                    <View style={s.progressWrap}>
                      <View style={s.progressTrack}>
                        <View
                          style={[
                            s.progressFill,
                            { width: `${progress}%`, backgroundColor: SERIES_COLORS[0] },
                          ]}
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
                          amount: l.amount,
                          borrowedOn: l.borrowedOn.slice(0, 10),
                          interestRate: l.interestRate,
                          rateEditable: l.rateChanges.length === 0,
                          assetId: l.personalAsset?.id ?? null,
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
                          {expanded[`rate-${l.id}`] ? "▼" : "▶"} 金利変更履歴 (
                          {l.rateChanges.length}
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
                                      color:
                                        diff > 0 ? "#dc2626" : diff < 0 ? "#16a34a" : "#94a3b8",
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
                                      openPending(l, c);
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
                </View>
              );
            })
          )}
        </Card>
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
                    residualValue: newLoan.residualValue
                      ? Number(newLoan.residualValue)
                      : undefined,
                    asset: assetPayload(newLoan),
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
            <Field label="残価（円）">
              <Input
                keyboardType="number-pad"
                value={newLoan.residualValue}
                placeholder="残価設定ローンのみ"
                onChangeText={(residualValue) => setNewLoan({ ...newLoan, residualValue })}
              />
            </Field>
            <Field label="この借入で買った資産">
              <Pills
                scroll={false}
                options={ASSET_MODES}
                value={newLoan.assetMode}
                onChange={(assetMode) =>
                  setNewLoan({
                    ...newLoan,
                    assetMode,
                    // 新しく作るときの既定: 名前は借入先、種別はローンの種別から
                    ...(assetMode === "new" && {
                      assetName: newLoan.assetName || newLoan.lenderName,
                      assetCategory: assetCategoryForLoanType(newLoan.loanType),
                    }),
                  })
                }
              />
              {newLoan.assetMode === "new" && (
                <>
                  <Input
                    value={newLoan.assetName}
                    placeholder={`資産名（${newLoan.lenderName || "借入先"}）`}
                    onChangeText={(assetName) => setNewLoan({ ...newLoan, assetName })}
                  />
                  <Pills
                    scroll={false}
                    options={CATEGORY_OPTIONS}
                    value={newLoan.assetCategory}
                    onChange={(assetCategory) => setNewLoan({ ...newLoan, assetCategory })}
                  />
                  <Input
                    keyboardType="number-pad"
                    value={newLoan.assetCost}
                    placeholder={`取得価格（${newLoan.amount || "借入額"}）`}
                    onChangeText={(assetCost) => setNewLoan({ ...newLoan, assetCost })}
                  />
                  <Input
                    keyboardType="number-pad"
                    value={newLoan.assetValue}
                    placeholder="評価額（取得価格と同じ）"
                    onChangeText={(assetValue) => setNewLoan({ ...newLoan, assetValue })}
                  />
                </>
              )}
              {newLoan.assetMode === "link" && (
                <Pills
                  scroll={false}
                  options={assets
                    .filter((a) => a.loanId === null)
                    .map((a) => ({ value: a.id, label: a.name }))}
                  value={newLoan.assetId}
                  onChange={(assetId) => setNewLoan({ ...newLoan, assetId })}
                />
              )}
              <Text style={s.muted}>{LOANS_HELP.asset}</Text>
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
                    amount: Number(editForm.amount),
                    borrowedOn: editForm.borrowedOn,
                    ...(editForm.rateEditable && { interestRate: Number(editForm.interestRate) }),
                    assetId: editForm.assetId,
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
            <Field label="借入金額（円）">
              <Input
                keyboardType="number-pad"
                value={editForm.amount}
                onChangeText={(amount) => setEditForm({ ...editForm, amount })}
              />
            </Field>
            <Field label="借入日（YYYY-MM-DD）">
              <Input
                value={editForm.borrowedOn}
                onChangeText={(borrowedOn) => setEditForm({ ...editForm, borrowedOn })}
              />
            </Field>
            <Field label="年利率（例: 0.03）">
              <Input
                keyboardType="decimal-pad"
                editable={editForm.rateEditable}
                value={editForm.interestRate}
                onChangeText={(interestRate) => setEditForm({ ...editForm, interestRate })}
              />
              {!editForm.rateEditable && (
                <Text style={s.muted}>
                  金利変更の履歴があるローンは、「金利変更」から登録してください。
                </Text>
              )}
            </Field>
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
            <Field label="この借入で買った資産">
              <Pills
                scroll={false}
                options={[
                  { value: 0, label: "なし" },
                  ...assets
                    .filter((a) => a.loanId === null || a.loanId === editForm.loan.id)
                    .map((a) => ({ value: a.id, label: a.name })),
                ]}
                value={editForm.assetId ?? 0}
                onChange={(id) => setEditForm({ ...editForm, assetId: id === 0 ? null : id })}
              />
              <Text style={s.muted}>{LOANS_HELP.asset}</Text>
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
              {currentMonthly !== null && (
                <Button
                  small
                  variant="secondary"
                  label={`据え置き（${yen(currentMonthly)}）`}
                  onPress={() =>
                    setRateForm({ ...rateForm, monthlyPayment: String(currentMonthly) })
                  }
                  style={{ alignSelf: "flex-start", marginTop: 6 }}
                />
              )}
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
        subtitle="金融機関の通知どおりの返済額を選んでください。5 年ルールなら「据え置き」のまま反映します。以降の残高・予算がこの額で計算されます。"
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
            {pendingForm.choices.map((c) => {
              const selected = pendingForm.choice === c.key;
              return (
                <TouchableOpacity
                  key={c.key}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  style={[s.choice, selected && s.choiceOn]}
                  onPress={() =>
                    setPendingForm({
                      ...pendingForm,
                      choice: c.key,
                      monthlyPayment: c.amount !== null ? String(c.amount) : "",
                    })
                  }
                >
                  <Text style={s.choiceLabel}>
                    {selected ? "● " : "○ "}
                    {c.label}
                    {c.amount !== null ? `  ${yen(c.amount)}` : ""}
                  </Text>
                  <Text style={s.muted}>{c.note}</Text>
                </TouchableOpacity>
              );
            })}
            {pendingForm.choice === "custom" && (
              <Input
                autoFocus
                keyboardType="number-pad"
                placeholder="金融機関の通知額"
                value={pendingForm.monthlyPayment}
                onChangeText={(monthlyPayment) =>
                  setPendingForm({ ...pendingForm, monthlyPayment })
                }
              />
            )}
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
  choice: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    padding: 10,
    marginBottom: 8,
  },
  choiceOn: { borderColor: "#fbbf24", backgroundColor: "#fffbeb" },
  choiceLabel: { fontSize: 13, color: "#1e293b", fontWeight: "600" },
  totalValue: { fontSize: 20, fontWeight: "700", color: "#dc2626" },
  subTitle: { fontSize: 12, fontWeight: "600", color: "#334155", marginTop: 12, marginBottom: 6 },
  trendItem: { borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingTop: 8, marginTop: 8 },
  trendName: { fontSize: 13, fontWeight: "600", color: "#1e293b", flexShrink: 1 },
  chartLabel: { fontSize: 10, color: "#64748b", marginTop: 6 },
  loanBlock: {
    borderWidth: 1,
    borderColor: "#f1f5f9",
    borderRadius: 10,
    padding: 10,
    marginBottom: 8,
  },
  loanTop: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  balanceBox: { alignItems: "flex-end" },
  balanceLabel: { fontSize: 10, color: "#94a3b8" },
  muted: { fontSize: 11, color: "#94a3b8", lineHeight: 16, marginTop: 3 },
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
    marginBottom: 10,
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
