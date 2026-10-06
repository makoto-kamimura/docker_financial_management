// 明細から見つけた「毎月の入出金」の候補（web 版 components/RecurringSuggestionsPanel.tsx と同じ）。
// 「登録」で資金移動ルールになり、資金繰り・資金フロー図に入る。「非表示」は記録して以後は出さない。
import { useEffect, useState } from "react";
import { Alert, StyleSheet, Text, View } from "react-native";
import {
  dismissTransferSuggestion,
  fetchTransferSuggestions,
  postTransfer,
  type RecurringSuggestion,
} from "../api";
import { yen } from "../format";
import { BANK_HELP } from "../shared/help-texts";
import { Button, Card, SectionTitle } from "./ui";

export function RecurringSuggestions({
  reloadKey,
  onChanged,
  accountId = null,
}: {
  reloadKey: number;
  /** 「表示する銀行」で選んだ口座。null / 省略はすべての口座の候補を出す */
  accountId?: number | null;
  /** 登録・非表示のあと（資金繰りなどを取り直すため） */
  onChanged: () => void;
}) {
  const [all, setItems] = useState<RecurringSuggestion[]>([]);
  const items = accountId === null ? all : all.filter((x) => x.accountId === accountId);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetchTransferSuggestions()
      .then(setItems)
      .catch(() => setItems([]));
  }, [reloadKey]);

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
      onChanged();
    } catch (e) {
      Alert.alert("エラー", e instanceof Error ? e.message : "処理に失敗しました");
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) return null;
  return (
    <Card>
      <SectionTitle note={BANK_HELP.suggestions}>
        毎月の入出金の候補（{items.length} 件）
      </SectionTitle>
      {items.map((s) => (
        <View key={`${s.accountId}:${s.signature}`} style={st.row}>
          <Text style={st.label}>
            <Text style={s.direction === "in" ? st.in : st.out}>
              {s.direction === "in" ? "入金 " : "出金 "}
            </Text>
            {s.label}
          </Text>
          <Text style={st.detail}>
            {yen(s.amount)} ・ 毎月{s.day}日 ・ {s.accountName} ・ 直近6か月のうち {s.months} か月
          </Text>
          <View style={st.actions}>
            <Button
              small
              label="登録"
              disabled={busy}
              onPress={() =>
                run(() =>
                  postTransfer({
                    fromAccountId: s.direction === "out" ? s.accountId : null,
                    toAccountId: s.direction === "in" ? s.accountId : null,
                    amount: s.amount,
                    day: s.day,
                    label: s.label,
                    channel: s.direction === "in" ? "INCOME" : "EXPENSE",
                  }),
                )
              }
            />
            <Button
              small
              variant="secondary"
              label="非表示"
              disabled={busy}
              onPress={() => run(() => dismissTransferSuggestion(s.accountId, s.signature))}
            />
          </View>
        </View>
      ))}
    </Card>
  );
}

const st = StyleSheet.create({
  row: { borderTopWidth: 1, borderTopColor: "#f1f5f9", paddingVertical: 8 },
  label: { fontSize: 13, color: "#1e293b", fontWeight: "600" },
  in: { color: "#047857" },
  out: { color: "#be123c" },
  detail: { fontSize: 11, color: "#64748b", marginTop: 2 },
  actions: { flexDirection: "row", gap: 8, marginTop: 6 },
});
