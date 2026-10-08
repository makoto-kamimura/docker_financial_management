// 明細の登録フォーム（銀行・カードのカレンダー）の科目の欄（web 版 components/EntryCategoryField.tsx と同じ）。
// 選んだ科目を付けて登録すると、その明細がそのまま実績になる。「自動」のままなら、サーバーが
// 学習ルール（摘要のキーワード）で科目を決め、当たらなければ未割り当てになる。
import { useState } from "react";
import { StyleSheet, Text, TouchableOpacity } from "react-native";
import type { Account, ViewMode } from "../api";
import { displayName } from "../shared/display-name";
import { AccountPickerModal } from "./CategoryPickerModal";
import { Field } from "./ui";

/** 出金（支出）・入金（収入）で選べる科目の区分 */
const CATEGORIES = {
  expense: ["EXPENSE", "COGS"],
  income: ["REVENUE"],
} as const;

const AUTO_LABEL = "自動（学習した科目。無ければ未割り当て）";

/** 選んだ科目を API の categoryAccountId にする（未選択 = 省略 = 学習ルール） */
export const categoryPayload = (account: Account | null) =>
  account ? { categoryAccountId: account.id } : {};

export function EntryCategoryField({
  accounts,
  value,
  onChange,
  direction,
  viewMode,
}: {
  accounts: Account[];
  value: Account | null;
  onChange: (account: Account | null) => void;
  direction: "income" | "expense";
  viewMode: ViewMode;
}) {
  const [picking, setPicking] = useState(false);
  return (
    <Field label="科目">
      <TouchableOpacity style={s.picker} onPress={() => setPicking(true)}>
        <Text style={s.pickerText} numberOfLines={1}>
          {value ? `${value.code} ${displayName(value, viewMode)}` : AUTO_LABEL}
        </Text>
      </TouchableOpacity>
      <AccountPickerModal
        visible={picking}
        accounts={accounts}
        categories={CATEGORIES[direction]}
        title="科目"
        clearLabel={AUTO_LABEL}
        currentId={value?.id ?? null}
        onSelect={(a) => {
          onChange(a);
          setPicking(false);
        }}
        onClose={() => setPicking(false)}
      />
    </Field>
  );
}

const s = StyleSheet.create({
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
