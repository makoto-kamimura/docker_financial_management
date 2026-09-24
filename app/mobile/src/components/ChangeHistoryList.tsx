// 予算・実績の変更履歴（web 版 予算管理 / 実績管理の「履歴」タブと同じ列・並べ替え・ページ送り）。
import { useState } from "react";
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { Account, ChangeHistoryRow, HistoryQuery, HistorySort, ViewMode } from "../api";
import { displayName } from "../shared/display-name";
import { fmtDateTime, yen } from "../format";
import { CHANGE_ACTION_LABEL as ACTION_LABEL } from "../shared/labels";
import { AccountPickerModal } from "./CategoryPickerModal";
import { EmptyText, Pager } from "./ui";

export const HISTORY_PAGE_SIZE = 30;

export const INITIAL_HISTORY_QUERY: HistoryQuery = {
  limit: HISTORY_PAGE_SIZE,
  offset: 0,
  sort: "changedAt",
  order: "desc",
};

// 同じ列なら昇順・降順を入れ替え、別の列なら既定の向き（勘定科目は昇順、ほかは降順）から始める
export function toggleHistorySort(q: HistoryQuery, key: HistorySort): HistoryQuery {
  if (q.sort === key) return { ...q, offset: 0, order: q.order === "desc" ? "asc" : "desc" };
  return { ...q, offset: 0, sort: key, order: key === "account" ? "asc" : "desc" };
}

const ACTION_COLOR: Record<string, string> = {
  create: "#15803d",
  update: "#b45309",
  delete: "#b91c1c",
};
const ACTION_BG: Record<string, string> = {
  create: "#f0fdf4",
  update: "#fffbeb",
  delete: "#fef2f2",
};

const SORT_LABEL: [HistorySort, string][] = [
  ["changedAt", "日時"],
  ["account", "勘定科目"],
  ["amount", "金額"],
];

type Props = {
  rows: ChangeHistoryRow[];
  total: number;
  query: HistoryQuery;
  onQueryChange: (q: HistoryQuery) => void;
  loading: boolean;
  viewMode: ViewMode;
  emptyText: string;
  /**
   * 指定すると、削除以外の行の勘定科目を押して付け替えられる（実績の履歴のみ。
   * PATCH /financials/{id} の accountId）。エラーは行の下に出す。
   */
  accountEdit?: {
    accounts: Account[];
    onChange: (row: ChangeHistoryRow, accountId: number) => Promise<void>;
  };
};

export function ChangeHistoryList({
  rows,
  total,
  query,
  onQueryChange,
  loading,
  viewMode,
  emptyText,
  accountEdit,
}: Props) {
  const [editing, setEditing] = useState<ChangeHistoryRow | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});

  async function changeAccount(row: ChangeHistoryRow, account: Account | null) {
    setEditing(null);
    if (!account || !accountEdit || account.id === row.account.id) return;
    setErrors((e) => ({ ...e, [row.historyId]: "" }));
    try {
      await accountEdit.onChange(row, account.id);
    } catch (e) {
      setErrors((m) => ({
        ...m,
        [row.historyId]: e instanceof Error ? e.message : "勘定科目の変更に失敗しました。",
      }));
    }
  }

  return (
    <View>
      {/* 並べ替え（web 版の列見出しクリックに相当） */}
      <View style={s.sortRow}>
        <Text style={s.sortLabel}>並べ替え</Text>
        {SORT_LABEL.map(([key, label]) => {
          const active = query.sort === key;
          return (
            <TouchableOpacity
              key={key}
              style={[s.sortBtn, active && s.sortBtnActive]}
              onPress={() => onQueryChange(toggleHistorySort(query, key))}
            >
              <Text style={[s.sortText, active && s.sortTextActive]}>
                {label} {active ? (query.order === "desc" ? "▼" : "▲") : "↕"}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <ActivityIndicator color="#4f46e5" style={{ marginVertical: 24 }} />
      ) : rows.length === 0 ? (
        <EmptyText>{emptyText}</EmptyText>
      ) : (
        <>
          <Text style={s.count}>
            全 {total.toLocaleString("ja-JP")} 件中 {query.offset + 1}〜
            {Math.min(query.offset + query.limit, total)} 件を表示
          </Text>
          {rows.map((h) => {
            const editable = accountEdit && h.action !== "delete" && h.targetId !== null;
            return (
              <View key={h.historyId} style={s.row}>
                <View style={[s.badge, { backgroundColor: ACTION_BG[h.action] ?? "#f1f5f9" }]}>
                  <Text style={[s.badgeText, { color: ACTION_COLOR[h.action] ?? "#374151" }]}>
                    {ACTION_LABEL[h.action] ?? h.action}
                  </Text>
                </View>
                <View style={s.info}>
                  <TouchableOpacity disabled={!editable} onPress={() => setEditing(h)}>
                    <Text style={[s.account, editable && s.accountEditable]}>
                      <Text style={s.code}>{h.account.code} </Text>
                      {displayName(h.account, viewMode)}
                      {editable ? " ▾" : ""}
                    </Text>
                  </TouchableOpacity>
                  {errors[h.historyId] ? <Text style={s.error}>{errors[h.historyId]}</Text> : null}
                  <Text style={s.meta}>
                    {h.period.fiscalYear}年 {h.period.month}月 ・ {fmtDateTime(h.changedAt)}
                  </Text>
                </View>
                <Text style={s.amount}>{yen(h.amount)}</Text>
              </View>
            );
          })}
          <Pager
            offset={query.offset}
            total={total}
            pageSize={query.limit}
            onChange={(offset) => onQueryChange({ ...query, offset })}
          />
        </>
      )}

      {accountEdit && (
        <AccountPickerModal
          visible={editing !== null}
          accounts={accountEdit.accounts}
          title="勘定科目を変更"
          description={
            editing
              ? `${editing.period.fiscalYear}年${editing.period.month}月 ${yen(editing.amount)}`
              : undefined
          }
          note="転記元の銀行・カード明細がある実績は、明細側の科目も一緒に変わります。"
          currentId={editing?.account.id ?? null}
          onSelect={(a) => editing && changeAccount(editing, a)}
          onClose={() => setEditing(null)}
        />
      )}
    </View>
  );
}

const s = StyleSheet.create({
  sortRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 10 },
  sortLabel: { fontSize: 11, color: "#64748b" },
  sortBtn: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    backgroundColor: "#fff",
  },
  sortBtnActive: { borderColor: "#a5b4fc", backgroundColor: "#eef2ff" },
  sortText: { fontSize: 11, color: "#64748b" },
  sortTextActive: { color: "#4338ca", fontWeight: "700" },
  count: { fontSize: 11, color: "#94a3b8", marginBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#fff",
    borderRadius: 10,
    padding: 12,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: "#e2e8f0",
    gap: 10,
  },
  badge: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  badgeText: { fontSize: 11, fontWeight: "700" },
  info: { flex: 1 },
  account: { fontSize: 13, color: "#1e293b", fontWeight: "500" },
  accountEditable: { color: "#4338ca" },
  code: { fontSize: 11, color: "#94a3b8" },
  error: { fontSize: 10, color: "#dc2626", marginTop: 2 },
  meta: { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  amount: { fontSize: 13, fontWeight: "700", color: "#1e293b" },
});
