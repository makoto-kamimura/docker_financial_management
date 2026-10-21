// 実績の画面の「履歴」の明細を、サーバーでページ送り・絞り込みして読む（web 版 LedgerTable.tsx の
// useLedgerHistory と同じ。GET /ledger/history）。現金・銀行・カードの履歴で共通に使う。
//   - 状態（全件・未割り当て・実績）・科目・事業利用のみ（個人事業主モード）・期間・摘要・金額で絞り、
//     30 件ずつ新しい順に出す
//   - toolbar（絞り込み）と pager（ページ送り）を一覧の上と下に置く
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { StyleSheet, Switch, Text, TouchableOpacity, View } from "react-native";
import {
  fetchLedgerHistory,
  getViewMode,
  type Account,
  type BusinessFields,
  type LedgerHistoryQuery,
  type LedgerHistoryRange,
  type LedgerHistoryStatus,
  type ViewMode,
} from "../api";
import { displayName } from "../shared/display-name";
import { AccountPickerModal } from "./CategoryPickerModal";
import { LedgerCount } from "./LedgerRow";
import { Button, COLORS, Field, Input, Pager, Pills } from "./ui";

export const LEDGER_PAGE_SIZE = 30;

const STATUS_FILTERS: { value: LedgerHistoryStatus; label: string }[] = [
  { value: "all", label: "全件" },
  { value: "unassigned", label: "未割り当て" },
  { value: "actual", label: "実績" },
];
const FILTER_CATEGORIES = ["REVENUE", "COGS", "EXPENSE"] as const;

const EMPTY_RANGE: LedgerHistoryRange = {
  dateFrom: "",
  dateTo: "",
  q: "",
  amountMin: "",
  amountMax: "",
};
const isEmptyRange = (r: LedgerHistoryRange) => Object.values(r).every((v) => v.trim() === "");

/** 入力の誤り（日付の形・範囲が逆）。問題なければ null */
function rangeError(r: LedgerHistoryRange): string | null {
  const ymd = /^\d{4}-\d{2}-\d{2}$/;
  for (const v of [r.dateFrom.trim(), r.dateTo.trim()]) {
    if (v && !ymd.test(v)) return "期間は YYYY-MM-DD で入れてください";
  }
  for (const v of [r.amountMin.trim(), r.amountMax.trim()]) {
    if (v && !(Number(v) >= 0)) return "金額は 0 以上の数で入れてください";
  }
  if (r.dateFrom.trim() && r.dateTo.trim() && r.dateFrom.trim() > r.dateTo.trim()) {
    return "期間の始まりが終わりより後です";
  }
  if (r.amountMin.trim() && r.amountMax.trim() && Number(r.amountMin) > Number(r.amountMax)) {
    return "金額の下限が上限より大きいです";
  }
  return null;
}

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
  // 期間・摘要・金額: 適用中の値と、開いた入力欄の下書き
  const [range, setRange] = useState<LedgerHistoryRange>(EMPTY_RANGE);
  const [draft, setDraft] = useState<LedgerHistoryRange>(EMPTY_RANGE);
  const [rangeOpen, setRangeOpen] = useState(false);
  const [rangeMessage, setRangeMessage] = useState<string | null>(null);
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
        range,
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
  }, [kind, accountId, status, categoryAccountId, sole, businessOnly, range, offset]);

  useEffect(() => {
    if (enabled) reload();
  }, [reload, enabled]);

  const category = accounts.find((a) => a.id === categoryAccountId) ?? null;
  const applyRange = (next: LedgerHistoryRange) => {
    const message = rangeError(next);
    setRangeMessage(message);
    if (message) return;
    setRange(next);
    setDraft(next);
    setOffset(0);
  };
  const ranged = !isEmptyRange(range);
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
        <TouchableOpacity
          style={[s.rangeToggle, ranged && s.rangeToggleOn]}
          onPress={() => setRangeOpen((v) => !v)}
          accessibilityLabel="期間・摘要・金額で絞り込む"
        >
          <Text style={[s.rangeToggleText, ranged && s.rangeToggleTextOn]}>
            {ranged ? "絞り込み中" : "絞り込み"} {rangeOpen ? "▲" : "▼"}
          </Text>
        </TouchableOpacity>
      </View>
      {rangeOpen && (
        <View style={s.rangePanel}>
          <View style={s.rangeRow}>
            <View style={s.rangeCell}>
              <Field label="期間の始まり（YYYY-MM-DD）">
                <Input
                  value={draft.dateFrom}
                  onChangeText={(v) => setDraft({ ...draft, dateFrom: v })}
                  placeholder="2026-03-01"
                  autoCapitalize="none"
                />
              </Field>
            </View>
            <View style={s.rangeCell}>
              <Field label="終わり">
                <Input
                  value={draft.dateTo}
                  onChangeText={(v) => setDraft({ ...draft, dateTo: v })}
                  placeholder="2026-03-31"
                  autoCapitalize="none"
                />
              </Field>
            </View>
          </View>
          <Field label="摘要（部分一致）">
            <Input
              value={draft.q}
              onChangeText={(v) => setDraft({ ...draft, q: v })}
              placeholder="JAL など"
              autoCapitalize="none"
              returnKeyType="search"
              onSubmitEditing={() => applyRange(draft)}
            />
          </Field>
          <View style={s.rangeRow}>
            <View style={s.rangeCell}>
              <Field label="金額の下限">
                <Input
                  value={draft.amountMin}
                  onChangeText={(v) => setDraft({ ...draft, amountMin: v })}
                  keyboardType="number-pad"
                />
              </Field>
            </View>
            <View style={s.rangeCell}>
              <Field label="上限">
                <Input
                  value={draft.amountMax}
                  onChangeText={(v) => setDraft({ ...draft, amountMax: v })}
                  keyboardType="number-pad"
                />
              </Field>
            </View>
          </View>
          <Text style={s.rangeNote}>金額は入金・出金を問わず比べます。</Text>
          {rangeMessage && <Text style={s.rangeError}>{rangeMessage}</Text>}
          <View style={s.rangeRow}>
            <Button label="適用" small onPress={() => applyRange(draft)} />
            <Button
              label="解除"
              small
              variant="secondary"
              onPress={() => applyRange(EMPTY_RANGE)}
            />
          </View>
        </View>
      )}
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
    filtered: status !== "all" || categoryAccountId !== null || (sole && businessOnly) || ranged,
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
  rangeToggle: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 8,
    backgroundColor: "#fff",
  },
  rangeToggleOn: { borderColor: COLORS.primary, backgroundColor: "#eef2ff" },
  rangeToggleText: { fontSize: 12, color: "#475569" },
  rangeToggleTextOn: { color: COLORS.primary, fontWeight: "600" },
  rangePanel: {
    marginTop: 8,
    padding: 10,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    backgroundColor: "#f8fafc",
  },
  rangeRow: { flexDirection: "row", gap: 8, alignItems: "flex-end" },
  rangeCell: { flex: 1 },
  rangeNote: { fontSize: 11, color: COLORS.sub, marginBottom: 6 },
  rangeError: { fontSize: 12, color: "#dc2626", marginBottom: 6 },
});
