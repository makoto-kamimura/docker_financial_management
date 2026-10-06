// 予算管理（web 版 /budget と同じ「明細一覧 / 予算配分 / 履歴」。CSV インポートは web 版のみ）。
// 明細一覧は web 版の「科目 × 月」の表を 1 か月ずつ表示する。行に出す科目・自動反映・適正額・年間合計は
// web 版と同じ規則で求める。
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  deleteBudget,
  fetchAccounts,
  fetchAllocationGuide,
  fetchBudgetHistory,
  fetchBudgets,
  postBudget,
  type Account,
  type AllocationGuideRow,
  type BudgetResponse,
  type HistoryPage,
  type HistoryQuery,
  type ViewMode,
} from "../api";
import { BudgetAllocationPanel } from "../components/BudgetAllocationPanel";
import { BudgetCalendar } from "../components/BudgetCalendar";
import { AccountPickerModal } from "../components/CategoryPickerModal";
import { ChangeHistoryList, INITIAL_HISTORY_QUERY } from "../components/ChangeHistoryList";
import {
  Button,
  EmptyText,
  Input,
  Lead,
  Notice,
  Pills,
  SheetModal,
  TabBar,
} from "../components/ui";
import { BUDGET_SOURCE_LABEL, buildBudgetCellDetail } from "../shared/budget-cell-detail";
import { displayName } from "../shared/display-name";
import { BUDGET_HELP, textFor } from "../shared/help-texts";
import { CATEGORY_LABEL, categoryRank } from "../shared/labels";
import { digitsOnly, MONTHS, yen } from "../format";
import { BudgetConfirmSection } from "../components/BudgetConfirmSection";
import { BudgetVarianceSection } from "../components/BudgetVarianceSection";
import { useFiscalYear } from "../fiscal-year";

export type BudgetTab = "manual" | "calendar" | "allocation" | "variance" | "confirm" | "history";
type Tab = BudgetTab;
const TABS = [
  ["manual", "一覧"],
  ["calendar", "カレンダー"],
  ["variance", "予実差確認"],
  ["confirm", "予算の確定"],
  ["history", "履歴"],
  ["allocation", "設定"],
] as const;

const EMPTY_BUDGETS: BudgetResponse = {
  budgets: [],
  years: [],
  loanOverlay: [],
  personalAssetDebtOverlay: [],
  confirmedMonths: [],
  items: [],
};

const key = (code: string, month: number) => `${code}:${month}`;

// 科目・月ごとの合計（同じ科目・月に複数行があれば合算する）
function sumBy<T extends { accountCode: string; month: number; amount: number }>(rows: T[]) {
  const map = new Map<string, number>();
  for (const r of rows)
    map.set(key(r.accountCode, r.month), (map.get(key(r.accountCode, r.month)) ?? 0) + r.amount);
  return map;
}

type Props = {
  viewMode: ViewMode;
  /** 開いたときのタブ（ホームの状況の 1 行から「予算の確定」を開くときなど） */
  initialTab?: Tab;
  /** 開いたタブの月の初期値（YYYY-MM。予実差確認は比べる月、予算の確定は予算の月） */
  initialMonth?: string;
  /** 実績の画面の「実績の確定」へ移る */
  onOpenActuals?: (month: string) => void;
};

export function BudgetScreen({ viewMode, initialTab, initialMonth, onOpenActuals }: Props) {
  const now = new Date();
  const [tab, setTab] = useState<Tab>(initialTab ?? "manual");
  // 予実差確認・予算の確定を、指定した月で開く（他の画面か、もう一方のタブのボタンから）。
  // key を変えて作り直し、その月から始める。月は開いたタブにだけ渡す
  const [cycleNav, setCycleNav] = useState<{ tab?: Tab; month?: string; key: number }>({
    tab: initialTab,
    month: initialMonth,
    key: 0,
  });
  const openCycleTab = (next: "variance" | "confirm", m: string) => {
    setCycleNav((n) => ({ tab: next, month: m, key: n.key + 1 }));
    setTab(next);
  };
  const cycleMonthFor = (t: Tab) => (cycleNav.tab === t ? cycleNav.month : undefined);
  // 年度の既定はサーバー（GET /budgets）と同じ当年
  // 対象年度は画面上部のサブヘッダーで選ぶ（全画面で共通）
  const year = useFiscalYear();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [data, setData] = useState<BudgetResponse>(EMPTY_BUDGETS);
  const [guide, setGuide] = useState<AllocationGuideRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 入力中の金額（科目コード → 文字列）。保存で POST（同じ科目・月は上書き）する
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  // 予算がまだ無い科目を行として足す（web 版の「科目を追加」）
  const [extraCodes, setExtraCodes] = useState<string[]>([]);
  const [pickingAccount, setPickingAccount] = useState(false);

  const [histQuery, setHistQuery] = useState<HistoryQuery>(INITIAL_HISTORY_QUERY);
  const [history, setHistory] = useState<HistoryPage>({ data: [], total: 0 });
  const [histLoading, setHistLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    setEdits({});
    try {
      const [accs, budgets, g] = await Promise.all([
        fetchAccounts(),
        fetchBudgets(year),
        fetchAllocationGuide(year).catch(() => []),
      ]);
      setAccounts(accs);
      setData(budgets);
      setGuide(g);
    } catch (e) {
      setError(e instanceof Error ? e.message : "予算データの取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [year]);

  useEffect(() => {
    setLoading(true);
    load();
  }, [load]);

  useEffect(() => {
    if (tab !== "history") return;
    setHistLoading(true);
    fetchBudgetHistory(year, histQuery)
      .then(setHistory)
      .catch(() => setHistory({ data: [], total: 0 }))
      .finally(() => setHistLoading(false));
  }, [tab, year, histQuery]);

  async function onRefresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  // ── 表の組み立て（web 版 /budget と同じ規則）──────────────────────────
  const budgetMap = useMemo(() => {
    const map = new Map<string, BudgetResponse["budgets"][number]>();
    for (const b of data.budgets) map.set(key(b.account.code, b.period.month), b);
    return map;
  }, [data.budgets]);
  const loanMap = useMemo(() => sumBy(data.loanOverlay), [data.loanOverlay]);
  const debtMap = useMemo(
    () => sumBy(data.personalAssetDebtOverlay),
    [data.personalAssetDebtOverlay],
  );
  const guideMap = useMemo(() => sumBy(guide), [guide]);

  // 行に出す科目: 予算がある・ローン/負債の自動反映がある・「科目を追加」で足した科目
  const rows = useMemo(() => {
    const codes = new Set<string>([
      ...data.budgets.map((b) => b.account.code),
      ...data.loanOverlay.map((o) => o.accountCode),
      ...data.personalAssetDebtOverlay.map((o) => o.accountCode),
      ...extraCodes,
    ]);
    return accounts
      .filter((a) => codes.has(a.code))
      .sort(
        (a, b) =>
          categoryRank(a.category) - categoryRank(b.category) || a.code.localeCompare(b.code),
      );
  }, [accounts, data, extraCodes]);

  const debtAssetNames = (code: string) =>
    [
      ...new Set(
        data.personalAssetDebtOverlay.filter((o) => o.accountCode === code).map((o) => o.assetName),
      ),
    ].join("・");

  const annualOf = (code: string) =>
    MONTHS.reduce(
      (sum, m) =>
        sum +
        (budgetMap.get(key(code, m))?.amount ?? 0) +
        (loanMap.get(key(code, m)) ?? 0) +
        (debtMap.get(key(code, m)) ?? 0),
      0,
    );

  async function handleSave() {
    const entries = Object.entries(edits).filter(([, v]) => v.trim() !== "");
    if (entries.length === 0) return;
    setSaving(true);
    try {
      await Promise.all(
        entries.map(([code, v]) =>
          postBudget({ accountCode: code, fiscalYear: year, month, amount: Number(v) || 0 }),
        ),
      );
      await load();
    } catch (e) {
      Alert.alert("保存エラー", e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
    }
  }

  function confirmDelete(id: number, label: string) {
    Alert.alert("予算を削除", `${label} の ${month}月の予算を削除します。よろしいですか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteBudget(id);
            await load();
          } catch (e) {
            Alert.alert("削除エラー", e instanceof Error ? e.message : "削除に失敗しました");
          }
        },
      },
    ]);
  }

  const hasEdits = Object.values(edits).some((v) => v.trim() !== "");
  // 予算を確定済みの月は編集できない（web 版の一覧の鍵の印と同じ）
  const locked = data.confirmedMonths.includes(month);

  // セルの内訳（カレンダーの登録・一覧などで入れた額・自動加算。web 版と同じ lib/budget-cell-detail.ts）
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const cellDetailOf = (code: string) =>
    buildBudgetCellDetail({
      budgetAmount: budgetMap.get(key(code, month))?.amount ?? 0,
      items: data.items.filter((i) => i.accountCode === code && i.month === month),
      loanOverlay: loanMap.get(key(code, month)) ?? 0,
      assetDebtOverlay: debtMap.get(key(code, month)) ?? 0,
      assetNames: debtAssetNames(code) ? debtAssetNames(code).split("・") : [],
    });

  return (
    <View style={s.root}>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />

      {loading ? (
        <View style={s.center}>
          <ActivityIndicator color="#4f46e5" size="large" />
        </View>
      ) : (
        <ScrollView
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          keyboardShouldPersistTaps="handled"
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        >
          {error && <Notice tone="error">{error}</Notice>}
          <Lead>{textFor(BUDGET_HELP.page, viewMode)}</Lead>

          {/* 予実差確認（選んだ月の予算と実績を見比べる） */}
          {tab === "variance" && (
            <BudgetVarianceSection
              key={`variance-${cycleNav.key}`}
              viewMode={viewMode}
              initialMonth={cycleMonthFor("variance")}
              onOpenConfirm={(m) => openCycleTab("confirm", m)}
              onOpenActuals={onOpenActuals}
            />
          )}

          {/* 予算の確定（予算の月の予算案を、前月の差額の扱いから作って確定する） */}
          {tab === "confirm" && (
            <BudgetConfirmSection
              key={`confirm-${cycleNav.key}`}
              viewMode={viewMode}
              initialMonth={cycleMonthFor("confirm")}
              onOpenActuals={onOpenActuals}
              onOpenVariance={(m) => openCycleTab("variance", m)}
            />
          )}

          {tab === "manual" && (
            <>
              <Pills
                options={MONTHS.map((m) => ({
                  value: m,
                  label: data.confirmedMonths.includes(m) ? `🔒${m}月` : `${m}月`,
                }))}
                value={month}
                onChange={(m) => {
                  setMonth(m);
                  setEdits({});
                }}
              />
              {locked && (
                <Notice tone="info">
                  {`🔒 ${month}月の予算は確定済みです。${BUDGET_HELP.cycleLocked}`}
                </Notice>
              )}
              {/* 金額に付く印の意味。出ている印の分だけ説明する（web 版の「表の印の見かた」） */}
              {(guide.length > 0 || loanMap.size > 0 || debtMap.size > 0) && (
                <Notice>
                  {[
                    guide.length > 0 ? `適正 ¥…：${BUDGET_HELP.guide}` : null,
                    loanMap.size > 0 ? `自動反映：${BUDGET_HELP.autoLoan}` : null,
                    debtMap.size > 0 ? `負債返済分：${BUDGET_HELP.autoDebt}` : null,
                  ]
                    .filter(Boolean)
                    .join("\n")}
                </Notice>
              )}

              {rows.length === 0 ? (
                <EmptyText>
                  予算データがありません。「科目を追加」で科目を選ぶと、月ごとに予算を入力できます。
                </EmptyText>
              ) : (
                rows.map((a, i) => {
                  const k = key(a.code, month);
                  const budget = budgetMap.get(k);
                  const loan = loanMap.get(k) ?? 0;
                  const debt = debtMap.get(k) ?? 0;
                  const guideAmount = guideMap.get(k) ?? 0;
                  const edited = a.code in edits;
                  const val = edited ? edits[a.code] : budget ? String(budget.amount) : "";
                  const base = val !== "" ? Number(val) : 0;
                  const name = displayName(a, viewMode);
                  // カレンダーの登録があるセルは合計をその場で書き換えさせない（内訳と合わなくなるため）
                  const detail = cellDetailOf(a.code);
                  const hasItems = detail.rows.some((r) => r.kind === "calendar");
                  const showGroup = i === 0 || rows[i - 1].category !== a.category;
                  return (
                    <View key={a.code}>
                      {showGroup && (
                        <Text style={s.groupLabel}>{CATEGORY_LABEL[a.category] ?? a.category}</Text>
                      )}
                      <View style={[s.row, edited && s.rowEdited]}>
                        <View style={s.rowInfo}>
                          <Text style={s.rowCode}>{a.code}</Text>
                          <Text style={s.rowName} numberOfLines={1}>
                            {name}
                          </Text>
                          {loan > 0 && (
                            <Text style={s.loanNote}>内 ローン返済 {yen(loan)}（自動反映）</Text>
                          )}
                          {debt > 0 && (
                            <Text style={s.debtNote} numberOfLines={1}>
                              内 負債返済分 {yen(debt)}（{debtAssetNames(a.code)}）
                            </Text>
                          )}
                          {guideAmount > 0 && (
                            <Text style={s.guideText}>適正 {yen(guideAmount)}</Text>
                          )}
                          <Text style={s.annual}>年間合計 {yen(annualOf(a.code))}</Text>
                        </View>
                        <View style={s.rowRight}>
                          <View style={s.inputRow}>
                            <Input
                              style={s.amountInput}
                              keyboardType="number-pad"
                              editable={!locked && !hasItems}
                              value={val}
                              placeholder="—"
                              selectTextOnFocus
                              onChangeText={(t) =>
                                setEdits((prev) => ({ ...prev, [a.code]: digitsOnly(t) }))
                              }
                            />
                            {budget && !edited && !locked && !hasItems && (
                              <TouchableOpacity
                                onPress={() => confirmDelete(budget.id, name)}
                                hitSlop={8}
                              >
                                <Text style={s.delete}>削除</Text>
                              </TouchableOpacity>
                            )}
                          </View>
                          {(loan > 0 || debt > 0) && (
                            <Text style={s.combined}>合計 {yen(base + loan + debt)}</Text>
                          )}
                          {(hasItems || detail.rows.length > 1) && (
                            <TouchableOpacity onPress={() => setDetailCode(a.code)} hitSlop={6}>
                              <Text style={s.detailLink}>内訳 {detail.rows.length}件</Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })
              )}

              <Button
                variant="secondary"
                label="＋ 科目を追加"
                onPress={() => setPickingAccount(true)}
                style={{ marginTop: 8 }}
              />
              <View style={{ height: hasEdits ? 88 : 24 }} />
            </>
          )}

          {tab === "calendar" && (
            <BudgetCalendar
              accounts={accounts}
              viewMode={viewMode}
              year={year}
              confirmedMonths={data.confirmedMonths}
              onChanged={load}
            />
          )}

          {tab === "allocation" && (
            <BudgetAllocationPanel
              fiscalYear={year}
              viewMode={viewMode}
              onApplied={() => {
                load();
                setHistQuery((q) => ({ ...q }));
              }}
            />
          )}

          {tab === "history" && <Lead>{BUDGET_HELP.history}</Lead>}
          {tab === "history" && (
            <ChangeHistoryList
              rows={history.data}
              total={history.total}
              query={histQuery}
              onQueryChange={setHistQuery}
              loading={histLoading}
              viewMode={viewMode}
              emptyText={`まだ${year}年度の履歴はありません。`}
            />
          )}
        </ScrollView>
      )}

      {tab === "manual" && hasEdits && (
        <View style={s.saveBar}>
          <Button label="保存する" onPress={handleSave} loading={saving} />
        </View>
      )}

      <AccountPickerModal
        visible={pickingAccount}
        accounts={accounts.filter((a) => !rows.some((r) => r.code === a.code))}
        title="科目を追加"
        currentId={null}
        onSelect={(a) => {
          if (a) setExtraCodes((codes) => (codes.includes(a.code) ? codes : [...codes, a.code]));
          setPickingAccount(false);
        }}
        onClose={() => setPickingAccount(false)}
      />
      {/* セルの内訳（web 版の一覧の「N件」と同じ） */}
      <SheetModal
        visible={detailCode !== null}
        title={`${detailCode ? displayName(accounts.find((x) => x.code === detailCode) ?? { name: detailCode }, viewMode) : ""} ${month}月の予算の内訳`}
        subtitle={BUDGET_HELP.cellDetail}
        onClose={() => setDetailCode(null)}
      >
        {detailCode &&
          cellDetailOf(detailCode).rows.map((r, i) => (
            <View key={r.kind === "calendar" ? `c${r.id}` : `${r.kind}${i}`} style={s.detailRow}>
              <View style={{ flex: 1 }}>
                <Text style={s.detailSource}>{BUDGET_SOURCE_LABEL[r.kind]}</Text>
                {r.kind === "calendar" && (
                  <Text style={s.detailDesc} numberOfLines={2}>
                    {r.date.slice(5).replace("-", "/")} · {r.description}
                  </Text>
                )}
                {r.kind === "assetDebt" && r.assetNames.length > 0 && (
                  <Text style={s.detailDesc}>{r.assetNames.join("・")}</Text>
                )}
              </View>
              <Text style={s.detailAmount}>{yen(r.amount)}</Text>
            </View>
          ))}
        {detailCode && (
          <Text style={s.detailTotal}>合計 {yen(cellDetailOf(detailCode).total)}</Text>
        )}
      </SheetModal>
    </View>
  );
}

const s = StyleSheet.create({
  detailLink: { fontSize: 11, color: "#4f46e5", textDecorationLine: "underline", marginTop: 2 },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  detailSource: { fontSize: 11, color: "#64748b" },
  detailDesc: { fontSize: 13, color: "#1e293b", marginTop: 2 },
  detailAmount: { fontSize: 13, fontWeight: "600", color: "#1e293b" },
  detailTotal: {
    fontSize: 13,
    fontWeight: "700",
    color: "#1e293b",
    textAlign: "right",
    marginTop: 10,
  },
  root: { flex: 1, backgroundColor: "#f8fafc" },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  scroll: { flex: 1 },
  scrollContent: { padding: 14 },
  groupLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: 0.6,
    marginTop: 10,
    marginBottom: 6,
    paddingLeft: 2,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
  },
  rowEdited: { borderColor: "#818cf8", backgroundColor: "#eef2ff" },
  rowInfo: { flex: 1, marginRight: 8 },
  rowCode: { fontSize: 10, color: "#94a3b8" },
  rowName: { fontSize: 13, color: "#1e293b", fontWeight: "500", marginTop: 1 },
  loanNote: { fontSize: 10, color: "#4f46e5", marginTop: 2 },
  debtNote: { fontSize: 10, color: "#d97706", marginTop: 2 },
  guideText: { fontSize: 10, color: "#059669", marginTop: 2 },
  annual: { fontSize: 10, color: "#64748b", marginTop: 3 },
  rowRight: { alignItems: "flex-end" },
  inputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  amountInput: { width: 110, textAlign: "right", paddingVertical: 6, fontWeight: "600" },
  delete: { fontSize: 11, color: "#dc2626", fontWeight: "600" },
  combined: { fontSize: 10, color: "#4f46e5", marginTop: 3, fontWeight: "600" },
  saveBar: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    padding: 12,
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#e2e8f0",
  },
});
