// 実績の画面の「履歴」の明細を、サーバーでページ送り・絞り込みして読む（web 版 LedgerTable.tsx の
// useLedgerHistory と同じ。GET /ledger/history）。現金・銀行・カードの履歴で共通に使う。
//   - 状態（全件・未割り当て・実績）・科目・事業利用のみ（個人事業主モード）で絞り、30 件ずつ新しい順に出す
//   - toolbar（絞り込み）と pager（ページ送り）を一覧の上と下に置く
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import {
  fetchLedgerHistory,
  getViewMode,
  type Account,
  type BusinessFields,
  type LedgerHistoryQuery,
  type LedgerHistoryStatus,
  type ViewMode,
} from "../api";
import { displayName } from "../shared/display-name";
import { AccountPickerModal } from "./CategoryPickerModal";
import { LedgerCount } from "./LedgerRow";
import { COLORS, Pager, Pills } from "./ui";

export const LEDGER_PAGE_SIZE = 30;

const STATUS_FILTERS: { value: LedgerHistoryStatus; label: string }[] = [
  { value: "all", label: "全件" },
  { value: "unassigned", label: "未割り当て" },
  { value: "actual", label: "実績" },
];
const FILTER_CATEGORIES = ["REVENUE", "COGS", "EXPENSE"] as const;

export function useLedgerHistory<T extends { amount: unknown }>({
  kind,
  accountId = null,
  viewMode,
  accounts,
  enabled = true,
}: {
  kind: LedgerHistoryQuery["kind"];
  accountId?: number | null;
  viewMode: ViewMode;
  /** 科目の絞り込みの選択肢（fetchAccounts() の結果） */
  accounts: Account[];
  /** false の間は読まない（履歴を開いていないとき） */
  enabled?: boolean;
}): {
  rows: (T & BusinessFields)[];
  total: number;
  loading: boolean;
  error: string | null;
  /** 明細を変えたあとに読み直す */
  reload: () => Promise<void>;
  /** 絞り込みをしているか（空の一覧の文言を変える） */
  filtered: boolean;
  status: LedgerHistoryStatus;
  toolbar: ReactNode;
  pager: ReactNode;
} {
  const sole = viewMode === "sole";
  const [offset, setOffset] = useState(0);
  const [status, setStatus] = useState<LedgerHistoryStatus>("all");
  const [categoryAccountId, setCategoryAccountId] = useState<number | null>(null);
  const [businessOnly, setBusinessOnly] = useState(true);
  const [picking, setPicking] = useState(false);
  const [rows, setRows] = useState<(T & BusinessFields)[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 口座を切り替えたら 1 ページ目に戻す
  useEffect(() => setOffset(0), [accountId]);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const res = await fetchLedgerHistory<T>({
        kind,
        accountId,
        status,
        categoryAccountId,
        businessOnly: sole && businessOnly,
        offset,
        limit: LEDGER_PAGE_SIZE,
      });
      setRows(res.data);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : "履歴の取得に失敗しました");
      setRows([]);
      setTotal(0);
    } finally {
      setLoading(false);
    }
  }, [kind, accountId, status, categoryAccountId, sole, businessOnly, offset]);

  useEffect(() => {
    if (enabled) reload();
  }, [reload, enabled]);

  const category = accounts.find((a) => a.id === categoryAccountId) ?? null;
  const toolbar = (
    <View>
      <Pills
        scroll={false}
        options={STATUS_FILTERS}
        value={status}
        onChange={(v) => {
          setStatus(v);
          setOffset(0);
        }}
      />
      <View style={s.row}>
        <TouchableOpacity style={s.picker} onPress={() => setPicking(true)}>
          <Text style={category ? s.pickerText : s.pickerPlaceholder} numberOfLines={1}>
            {category ? `${category.code} ${displayName(category, getViewMode())}` : "すべての科目"}
          </Text>
        </TouchableOpacity>
        {sole && (
          <View style={s.switchRow}>
            <Switch
              value={businessOnly}
              onValueChange={(v) => {
                setBusinessOnly(v);
                setOffset(0);
              }}
              accessibilityLabel="事業利用のみ"
            />
            <Text style={s.label}>事業利用のみ</Text>
          </View>
        )}
      </View>
      <LedgerCount total={total} offset={offset} pageSize={LEDGER_PAGE_SIZE} />
      <AccountPickerModal
        visible={picking}
        accounts={accounts}
        categories={FILTER_CATEGORIES}
        title="科目で絞り込む"
        clearLabel="すべての科目"
        currentId={categoryAccountId}
        onSelect={(a) => {
          setCategoryAccountId(a?.id ?? null);
          setOffset(0);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </View>
  );
  const pager =
    total > LEDGER_PAGE_SIZE ? (
      <Pager offset={offset} total={total} pageSize={LEDGER_PAGE_SIZE} onChange={setOffset} />
    ) : null;

  return {
    rows,
    total,
    loading,
    error,
    reload,
    filtered: status !== "all" || categoryAccountId !== null || (sole && businessOnly),
    status,
    toolbar,
    pager,
  };
}

const s = StyleSheet.create({
  row: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 6, flexWrap: "wrap" },
  picker: {
    flex: 1,
    minWidth: 160,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  pickerText: { fontSize: 13, color: "#1e293b" },
  pickerPlaceholder: { fontSize: 13, color: COLORS.sub },
  switchRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  label: { fontSize: 12, color: "#475569" },
});
