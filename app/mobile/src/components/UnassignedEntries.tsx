// 実績の確定タブの「未割り当ての明細」（web 版 components/ActualsConfirmPanel.tsx の UnassignedCard と同じ）。
// 科目が付いていない明細を並べ、行ごとに科目を選ぶと、その明細がそのまま実績になる
// （同じ摘要の未割り当ての明細にも付き、次の取り込みからも自動で付く）。残っている間は確定できない。
// 「まとめて自動処理」は、学習ルールで科目を付け、同じ日・同じ金額の送金と受金を振替・チャージの組にする。
import { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  autoProcessEntries,
  categorizeEntry,
  fetchAccounts,
  fetchUnassignedEntries,
  type Account,
  type UnassignedEntry,
} from "../api";
import { ENTRY_HELP, LEARNING_RULE_TERMS } from "../shared/help-texts";
import { fmtDate, yen } from "../format";
import { CategoryPickerModal } from "./CategoryPickerModal";
import { LedgerRow } from "./LedgerRow";
import { Button, COLORS, Notice, TermList } from "./ui";

const KIND_LABEL: Record<UnassignedEntry["kind"], string> = {
  CASH: "現金",
  BANK: "銀行",
  CARD: "カード",
};

export function UnassignedEntries({
  year,
  month,
  onChanged,
}: {
  year: number;
  month: number;
  /** 科目を付けたあと（確定の状況を読み直す） */
  onChanged: () => void;
}) {
  const [entries, setEntries] = useState<UnassignedEntry[] | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [picking, setPicking] = useState<UnassignedEntry | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [processing, setProcessing] = useState(false);

  const load = useCallback(async () => {
    try {
      setEntries(await fetchUnassignedEntries(year, month));
    } catch {
      setEntries([]);
    }
  }, [year, month]);

  useEffect(() => {
    setMsg(null);
    load();
  }, [load]);
  useEffect(() => {
    fetchAccounts()
      .then(setAccounts)
      .catch(() => setAccounts([]));
  }, []);

  async function run(action: () => Promise<string | null>) {
    setMsg(null);
    try {
      const text = await action();
      if (text) setMsg({ ok: true, text });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "処理に失敗しました" });
    }
    await load();
    onChanged();
  }

  // reset: 「科目を付け直す」（付いている科目も学習ルールで付け直し、当たらなければ未割り当てに戻す）
  function autoProcess(reset: boolean) {
    setProcessing(true);
    run(async () => {
      const r = await autoProcessEntries(reset);
      return (
        `学習ルールで ${r.categorized} 件に科目を付け` +
        (reset ? `、${r.cleared} 件を未割り当てに戻し` : "") +
        `、${r.offsetPairs} 組を振替・チャージにしました。` +
        (r.lockedSkipped > 0
          ? `（実績を確定済みの月の明細 ${r.lockedSkipped} 件はそのままです）`
          : "")
      );
    }).finally(() => setProcessing(false));
  }

  function confirmRecategorize() {
    Alert.alert("科目を付け直す", ENTRY_HELP.recategorize, [
      { text: "キャンセル", style: "cancel" },
      { text: "付け直す", style: "destructive", onPress: () => autoProcess(true) },
    ]);
  }

  return (
    <View style={s.box}>
      <Text style={s.title}>
        未割り当ての明細（{month}月・{entries?.length ?? 0} 件）
      </Text>
      <Text style={s.note}>{ENTRY_HELP.unassigned}</Text>
      <TermList terms={LEARNING_RULE_TERMS} label="学習ルールのしくみ" />
      <View style={s.btnRow}>
        <Button
          label={processing ? "処理中…" : "まとめて自動処理"}
          small
          variant="secondary"
          loading={processing}
          onPress={() => autoProcess(false)}
        />
        <Button
          label="科目を付け直す"
          small
          variant="secondary"
          disabled={processing}
          onPress={confirmRecategorize}
        />
      </View>
      {msg && <Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice>}
      {entries === null ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} />
      ) : entries.length === 0 ? (
        <Text style={s.done}>{month}月の明細には、すべて科目が付いています。</Text>
      ) : (
        entries.map((e) => (
          <LedgerRow
            key={`${e.kind}${e.id}`}
            date={fmtDate(e.date)}
            account={`${KIND_LABEL[e.kind]}・${e.sourceName}`}
            description={e.description}
            amount={yen(e.amount)}
            tone={e.amount < 0 ? "out" : "in"}
            category={
              <TouchableOpacity onPress={() => setPicking(e)}>
                <Text style={s.link}>科目を選ぶ</Text>
              </TouchableOpacity>
            }
          />
        ))
      )}

      <CategoryPickerModal
        visible={picking !== null}
        accounts={accounts}
        description={picking?.description}
        currentId={null}
        onSelect={(id) => {
          const e = picking;
          setPicking(null);
          if (e && id !== null)
            run(async () => {
              const { updatedSiblingCount: n } = await categorizeEntry(e.kind, e.id, id);
              return n > 0 ? `同じ摘要の未割り当ての明細 ${n} 件にも同じ科目を付けました。` : null;
            });
        }}
        onClose={() => setPicking(null)}
      />
    </View>
  );
}

const s = StyleSheet.create({
  box: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: 8,
    padding: 10,
    marginBottom: 12,
  },
  title: { fontSize: 12, fontWeight: "600", color: "#374151", marginBottom: 4 },
  note: { fontSize: 11, color: COLORS.sub, lineHeight: 16, marginBottom: 8 },
  btnRow: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 8 },
  done: { fontSize: 12, color: "#047857", marginVertical: 6 },
  link: { fontSize: 12, color: COLORS.primary, fontWeight: "600" },
});
