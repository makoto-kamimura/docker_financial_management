// 実績管理（web 版 /entry と同じ「明細一覧 / カレンダー / 履歴」。CSV インポートは web 版のみ）。
// 明細一覧は web 版の「科目 × 月」の表を 1 か月ずつ表示する。1 件だけのセルはその場で編集・削除でき、
// 複数件のセルは内訳シートで 1 件ずつ確認する。仕訳と連動した実績は仕訳帳から直す。
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
  deleteFinancialRecord,
  fetchAccounts,
  fetchFinancialMatrix,
  fetchRecordHistory,
  patchFinancialRecord,
  postFinancialRecord,
  type Account,
  type FinancialRecordRow,
  type HistoryPage,
  type HistoryQuery,
  type RecordSource,
  type ViewMode,
} from "../api";
import { ActualsCalendar } from "../components/ActualsCalendar";
import { ChangeHistoryList, INITIAL_HISTORY_QUERY } from "../components/ChangeHistoryList";
import { Button, EmptyText, Input, Notice, Pills, SheetModal, TabBar } from "../components/ui";
import { displayName } from "../shared/display-name";
import { buildFinancialMatrix, editableRecord, type MatrixCell } from "../shared/financial-matrix";
import { CATEGORY_LABEL, categoryRank } from "../shared/labels";
import { digitsOnly, fmtDate, fmtDateTime, MONTHS, yen } from "../format";

type Tab = "manual" | "calendar" | "history";
const TABS = [
  ["manual", "明細一覧"],
  ["calendar", "カレンダー"],
  ["history", "履歴"],
] as const;

// セル内訳に出す「どこから入った実績か」（web 版と同じ文言）
const SOURCE_LABEL: Record<RecordSource["kind"], string> = {
  bank: "銀行明細から転記",
  card: "カード明細から転記",
  journal: "仕訳と連動",
  direct: "手入力・CSV 取込",
};

// 金額入力中のセル（id あり = 既存 1 件の編集 / なし = 新規登録）
type CellEdit = { accountCode: string; id: number | null; amount: string };

type Props = { viewMode: ViewMode };

export function EntryScreen({ viewMode }: Props) {
  const now = new Date();
  const [tab, setTab] = useState<Tab>("manual");
  const [accounts, setAccounts] = useState<Account[]>([]);

  // ── 明細一覧 ────────────────────────────────────────────────
  const [year, setYear] = useState<number | null>(null); // null はサーバー既定（当年）
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [matrix, setMatrix] = useState<{
    year: number;
    years: number[];
    data: FinancialRecordRow[];
  }>({
    year: now.getFullYear(),
    years: [],
    data: [],
  });
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [edit, setEdit] = useState<CellEdit | null>(null);
  const [detailCode, setDetailCode] = useState<string | null>(null);
  const [detailEdit, setDetailEdit] = useState<{ id: number; amount: string } | null>(null);

  // ── 履歴 ────────────────────────────────────────────────────
  const [histQuery, setHistQuery] = useState<HistoryQuery>(INITIAL_HISTORY_QUERY);
  const [history, setHistory] = useState<HistoryPage>({ data: [], total: 0 });
  const [histLoading, setHistLoading] = useState(false);

  const loadMatrix = useCallback(async () => {
    setError(null);
    try {
      const [accs, m] = await Promise.all([
        fetchAccounts(),
        fetchFinancialMatrix(year ?? undefined),
      ]);
      setAccounts(accs);
      setMatrix(m);
    } catch (e) {
      setError(e instanceof Error ? e.message : "実績の取得に失敗しました");
    } finally {
      setLoading(false);
    }
  }, [year]);

  const loadHistory = useCallback(async () => {
    setHistLoading(true);
    try {
      setHistory(await fetchRecordHistory(histQuery));
    } catch {
      setHistory({ data: [], total: 0 });
    } finally {
      setHistLoading(false);
    }
  }, [histQuery]);

  useEffect(() => {
    loadMatrix();
  }, [loadMatrix]);

  useEffect(() => {
    if (tab === "history") loadHistory();
  }, [tab, loadHistory]);

  async function onRefresh() {
    setRefreshing(true);
    await (tab === "history" ? loadHistory() : loadMatrix());
    setRefreshing(false);
  }

  // 科目 × 月へ組み替え、予算管理と同じカテゴリ順で並べる
  const rows = useMemo(
    () =>
      buildFinancialMatrix(matrix.data).sort(
        (a, b) =>
          categoryRank(a.account.category) - categoryRank(b.account.category) ||
          a.account.code.localeCompare(b.account.code),
      ),
    [matrix.data],
  );
  const accountOf = (code: string) => accounts.find((a) => a.code === code);
  const nameOf = (acc: { code: string; name: string }) => {
    const a = accountOf(acc.code);
    return a ? displayName(a, viewMode) : acc.name;
  };

  const detailRow = detailCode ? rows.find((r) => r.account.code === detailCode) : undefined;
  const detailCell: MatrixCell<FinancialRecordRow> | undefined = detailRow?.byMonth.get(month);

  const yearOptions = [...new Set([...matrix.years, matrix.year])].sort((a, b) => a - b);

  async function run(action: () => Promise<void>) {
    try {
      await action();
      await loadMatrix();
    } catch (e) {
      Alert.alert("エラー", e instanceof Error ? e.message : "処理に失敗しました");
    }
  }

  async function saveCell() {
    if (!edit || edit.amount === "") return;
    const amount = Number(edit.amount);
    const target = edit;
    setEdit(null);
    await run(() =>
      target.id !== null
        ? patchFinancialRecord(target.id, { amount })
        : postFinancialRecord({
            accountCode: target.accountCode,
            fiscalYear: matrix.year,
            month,
            amount,
          }),
    );
  }

  function confirmDelete(r: FinancialRecordRow) {
    Alert.alert("実績を削除", `${yen(r.amount)} の実績を削除します。よろしいですか？`, [
      { text: "キャンセル", style: "cancel" },
      {
        text: "削除",
        style: "destructive",
        onPress: () => {
          if (detailEdit?.id === r.id) setDetailEdit(null);
          run(() => deleteFinancialRecord(r.id));
        },
      },
    ]);
  }

  async function saveDetail() {
    if (!detailEdit || detailEdit.amount === "") return;
    const { id, amount } = detailEdit;
    setDetailEdit(null);
    await run(() => patchFinancialRecord(id, { amount: Number(amount) }));
  }

  return (
    <View style={s.root}>
      <TabBar tabs={TABS} value={tab} onChange={setTab} />

      <ScrollView
        style={s.scroll}
        contentContainerStyle={s.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          tab === "calendar" ? undefined : (
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
          )
        }
      >
        {tab === "manual" &&
          (loading ? (
            <ActivityIndicator color="#4f46e5" style={{ marginTop: 40 }} />
          ) : (
            <>
              <View style={s.yearRow}>
                <Text style={s.yearCaption}>年度</Text>
                <Pills
                  options={yearOptions.map((y) => ({ value: y, label: `${y}年度` }))}
                  value={matrix.year}
                  onChange={(y) => {
                    setEdit(null);
                    setYear(y);
                  }}
                />
              </View>
              <Pills
                options={MONTHS.map((m) => ({ value: m, label: `${m}月` }))}
                value={month}
                onChange={(m) => {
                  setEdit(null);
                  setMonth(m);
                }}
              />
              {error && <Notice tone="error">{error}</Notice>}

              {rows.length === 0 ? (
                <EmptyText>
                  {matrix.year}年度の実績がありません。カレンダーから登録してください（CSV
                  インポートは Web 版で行えます）。
                </EmptyText>
              ) : (
                rows.map((row, i) => {
                  const cell = row.byMonth.get(month);
                  const single = editableRecord(cell);
                  const editing = edit?.accountCode === row.account.code ? edit : null;
                  const showGroup =
                    i === 0 || rows[i - 1].account.category !== row.account.category;
                  return (
                    <View key={row.account.code}>
                      {showGroup && (
                        <Text style={s.groupLabel}>
                          {CATEGORY_LABEL[row.account.category] ?? row.account.category}
                        </Text>
                      )}
                      <View style={s.row}>
                        <View style={{ flex: 1 }}>
                          <Text style={s.code}>{row.account.code}</Text>
                          <Text style={s.name} numberOfLines={1}>
                            {nameOf(row.account)}
                          </Text>
                          <Text style={s.annual}>年間合計 {yen(row.annual)}</Text>
                        </View>
                        {editing ? (
                          <View style={s.editRow}>
                            <Input
                              autoFocus
                              keyboardType="number-pad"
                              value={editing.amount}
                              placeholder="金額"
                              onChangeText={(t) => setEdit({ ...editing, amount: digitsOnly(t) })}
                              style={s.amountInput}
                            />
                            <Button small label="保存" onPress={saveCell} />
                            <TouchableOpacity onPress={() => setEdit(null)} hitSlop={8}>
                              <Text style={s.cancel}>取消</Text>
                            </TouchableOpacity>
                          </View>
                        ) : cell ? (
                          <View style={s.cellRight}>
                            <Text style={s.amount}>{yen(cell.total)}</Text>
                            {cell.records.length > 1 ? (
                              <TouchableOpacity onPress={() => setDetailCode(row.account.code)}>
                                <Text style={s.link}>{cell.records.length}件の内訳</Text>
                              </TouchableOpacity>
                            ) : single && single.journalEntryId !== null ? (
                              <Text style={s.muted}>仕訳（仕訳帳から修正）</Text>
                            ) : (
                              single && (
                                <View style={s.actions}>
                                  <TouchableOpacity
                                    onPress={() =>
                                      setEdit({
                                        accountCode: row.account.code,
                                        id: single.id,
                                        amount: String(single.amount),
                                      })
                                    }
                                  >
                                    <Text style={s.link}>編集</Text>
                                  </TouchableOpacity>
                                  <TouchableOpacity onPress={() => confirmDelete(single)}>
                                    <Text style={s.danger}>削除</Text>
                                  </TouchableOpacity>
                                </View>
                              )
                            )}
                          </View>
                        ) : (
                          <TouchableOpacity
                            onPress={() =>
                              setEdit({ accountCode: row.account.code, id: null, amount: "" })
                            }
                          >
                            <Text style={s.add}>— 追加</Text>
                          </TouchableOpacity>
                        )}
                      </View>
                    </View>
                  );
                })
              )}
            </>
          ))}

        {tab === "calendar" && <ActualsCalendar accounts={accounts} viewMode={viewMode} />}

        {tab === "history" && (
          <ChangeHistoryList
            rows={history.data}
            total={history.total}
            query={histQuery}
            onQueryChange={setHistQuery}
            loading={histLoading}
            viewMode={viewMode}
            emptyText="まだ履歴はありません。"
            accountEdit={{
              accounts,
              onChange: async (row, accountId) => {
                await patchFinancialRecord(row.targetId as number, { accountId });
                await loadHistory();
              },
            }}
          />
        )}
      </ScrollView>

      {/* ── セル内訳（同じ科目・月に複数の実績があるとき）── */}
      <SheetModal
        visible={detailCode !== null}
        title={detailRow ? nameOf(detailRow.account) : "実績の内訳"}
        subtitle={`${matrix.year}年${month}月 ・ 合計 ${yen(detailCell?.total ?? 0)}（${detailCell?.records.length ?? 0} 件）`}
        onClose={() => {
          setDetailCode(null);
          setDetailEdit(null);
        }}
      >
        {!detailCell || detailCell.records.length === 0 ? (
          <EmptyText>このセルの実績はすべて削除されました。</EmptyText>
        ) : (
          detailCell.records.map((r) => {
            const editing = detailEdit?.id === r.id ? detailEdit : null;
            return (
              <View key={r.id} style={s.detailRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.sourceBadge}>{SOURCE_LABEL[r.source.kind]}</Text>
                  <Text style={s.detailText} numberOfLines={2}>
                    {r.source.description
                      ? `${r.source.date ? `${fmtDate(r.source.date)} · ` : ""}${r.source.description}` +
                        (r.source.accountName ? `（${r.source.accountName}）` : "")
                      : "—"}
                  </Text>
                  <Text style={s.muted}>登録 {fmtDateTime(r.createdAt)}</Text>
                </View>
                {editing ? (
                  <View style={s.editRow}>
                    <Input
                      autoFocus
                      keyboardType="number-pad"
                      value={editing.amount}
                      onChangeText={(t) => setDetailEdit({ ...editing, amount: digitsOnly(t) })}
                      style={s.amountInput}
                    />
                    <Button small label="保存" onPress={saveDetail} />
                  </View>
                ) : (
                  <View style={s.cellRight}>
                    <Text style={s.amount}>{yen(r.amount)}</Text>
                    {r.journalEntryId !== null ? (
                      // 仕訳と連動した実績は仕訳側が正なのでここでは触らせない
                      <Text style={s.muted}>仕訳から修正</Text>
                    ) : (
                      <View style={s.actions}>
                        <TouchableOpacity
                          onPress={() => setDetailEdit({ id: r.id, amount: String(r.amount) })}
                        >
                          <Text style={s.link}>編集</Text>
                        </TouchableOpacity>
                        <TouchableOpacity onPress={() => confirmDelete(r)}>
                          <Text style={s.danger}>削除</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                )}
              </View>
            );
          })
        )}
      </SheetModal>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: "#f8fafc" },
  scroll: { flex: 1 },
  content: { padding: 14, paddingBottom: 32 },
  yearRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  yearCaption: { fontSize: 11, color: "#64748b" },
  groupLabel: {
    fontSize: 11,
    fontWeight: "700",
    color: "#94a3b8",
    letterSpacing: 0.6,
    marginTop: 12,
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
    gap: 8,
  },
  code: { fontSize: 10, color: "#94a3b8" },
  name: { fontSize: 13, color: "#1e293b", fontWeight: "500", marginTop: 1 },
  annual: { fontSize: 10, color: "#64748b", marginTop: 3 },
  cellRight: { alignItems: "flex-end", gap: 3 },
  amount: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  actions: { flexDirection: "row", gap: 12 },
  link: { fontSize: 12, color: "#4f46e5", fontWeight: "600" },
  danger: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
  muted: { fontSize: 10, color: "#94a3b8" },
  add: { fontSize: 12, color: "#94a3b8" },
  cancel: { fontSize: 12, color: "#64748b" },
  editRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  amountInput: { width: 100, textAlign: "right", paddingVertical: 6 },
  detailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  sourceBadge: { fontSize: 10, color: "#4338ca", fontWeight: "700" },
  detailText: { fontSize: 12, color: "#475569", marginTop: 2 },
});
