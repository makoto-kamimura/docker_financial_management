import { useMemo, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { getViewMode, type Account } from "../api";
import { displayName } from "../shared/display-name";
import { CATEGORY_LABEL } from "../shared/labels";
import { EmptyText, Input, SheetModal } from "./ui";

type AccountPickerProps = {
  visible: boolean;
  /** fetchAccounts() の結果。categories を渡すとその区分に絞る */
  accounts: Account[];
  categories?: readonly string[];
  title?: string;
  /** 対象（明細の摘要など）。見出しの下に出す */
  description?: string;
  /** 一覧の上に出す注意書き */
  note?: string;
  /** 未選択に戻す行の文言（null で行を出さない） */
  clearLabel?: string | null;
  /** 現在選ばれている科目 id（未選択は null） */
  currentId: number | null;
  onSelect: (account: Account | null) => void;
  onClose: () => void;
};

// 勘定科目を 1 つ選ぶボトムシート。表示名はモード別（displayName）で、コードでも絞り込める。
export function AccountPickerModal({
  visible,
  accounts,
  categories,
  title = "科目を選択",
  description,
  note,
  clearLabel = null,
  currentId,
  onSelect,
  onClose,
}: AccountPickerProps) {
  const [query, setQuery] = useState("");
  const mode = getViewMode();

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    return accounts
      .filter((a) => !categories || categories.includes(a.category))
      .map((a) => ({ account: a, label: displayName(a, mode) }))
      .filter(
        ({ account, label }) =>
          !q || label.toLowerCase().includes(q) || account.code.toLowerCase().includes(q),
      );
  }, [accounts, categories, query, mode]);

  return (
    <SheetModal visible={visible} title={title} subtitle={description} onClose={onClose}>
      <Input
        value={query}
        onChangeText={setQuery}
        placeholder="科目名・コードで絞り込み"
        autoCapitalize="none"
        style={{ marginBottom: 8 }}
      />
      {note ? <Text style={s.note}>{note}</Text> : null}

      {clearLabel !== null && (
        <TouchableOpacity style={s.row} onPress={() => onSelect(null)}>
          <Text style={[s.rowName, { color: "#94a3b8" }]}>{clearLabel}</Text>
          {currentId === null && <Text style={s.check}>✓</Text>}
        </TouchableOpacity>
      )}

      {items.length === 0 ? (
        <EmptyText>該当する科目がありません</EmptyText>
      ) : (
        items.map(({ account, label }) => (
          <TouchableOpacity key={account.id} style={s.row} onPress={() => onSelect(account)}>
            <View style={{ flex: 1 }}>
              <Text style={s.rowName}>{label}</Text>
              <Text style={s.rowMeta}>
                {account.code}・{CATEGORY_LABEL[account.category] ?? account.category}
              </Text>
            </View>
            {currentId === account.id && <Text style={s.check}>✓</Text>}
          </TouchableOpacity>
        ))
      )}
    </SheetModal>
  );
}

// 明細に紐付けられるのは収入・変動費・固定費のみ（web 版の明細一覧と同じ絞り込み）
const CATEGORIZABLE = ["REVENUE", "COGS", "EXPENSE"] as const;

type CategoryPickerProps = {
  visible: boolean;
  accounts: Account[];
  description?: string;
  currentId: number | null;
  onSelect: (categoryAccountId: number | null) => void;
  onClose: () => void;
};

// 銀行・カードの明細へ科目を紐付けるためのシート
export function CategoryPickerModal({ onSelect, ...props }: CategoryPickerProps) {
  return (
    <AccountPickerModal
      {...props}
      categories={CATEGORIZABLE}
      clearLabel="未紐付けに戻す"
      // web 版の科目ヘルプと同じ注意書き（二重計上の防止）
      note={
        "他項目で計上されていない、最終経路での支払いに科目を付けてください。" +
        "カードへのチャージなど別の項目で計上済みの支払いは二重計上になります。"
      }
      onSelect={(a) => onSelect(a?.id ?? null)}
    />
  );
}

const s = StyleSheet.create({
  note: { fontSize: 10, color: "#94a3b8", lineHeight: 15, marginBottom: 6 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 11,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  rowName: { fontSize: 14, color: "#334155" },
  rowMeta: { fontSize: 10, color: "#94a3b8", marginTop: 2 },
  check: { fontSize: 15, color: "#4f46e5", fontWeight: "700" },
});
