// 実績の確定タブの「未割り当ての明細」（web 版 components/ActualsConfirmPanel.tsx の UnassignedCard と同じ）。
// 科目が付いていない明細を並べ、行ごとに科目を選ぶと、その明細がそのまま実績になる
// （同じ摘要の未割り当ての明細にも付き、次の取り込みからも自動で付く）。残っている間は確定できない。
// 「まとめて自動処理」は、学習ルールで科目を付け、同じ日・同じ金額の送金と受金を振替・チャージの組にする。
// 「割り当て済みも表示」で科目の付いた明細も並べ、付けた科目と事業利用・按分を見直せる。事業利用と按分も
// 学習ルールに覚える。科目を選んで、その月のその科目の明細をまとめて事業利用にもできる。
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import {
  autoProcessEntries,
  categorizeEntry,
  fetchAccounts,
  fetchUnassignedEntries,
  getViewMode,
  setMonthBusinessUse,
  type Account,
  type EntryChange,
  type UnassignedEntry,
} from "../api";
import { ENTRY_HELP, LEARNING_RULE_TERMS } from "../shared/help-texts";
import { BUSINESS_USE_LABEL, isValidBusinessRatio } from "../shared/business-use";
import { displayName } from "../shared/display-name";
import { BusinessRatioControl } from "./BusinessUseControls";
import { fmtDate, yenAbs } from "../format";
import { flowLabel, flowSide } from "../shared/amount-direction";
import { CategoryPickerModal } from "./CategoryPickerModal";
import { LedgerRow } from "./LedgerRow";
import { Button, COLORS, Input, Notice, TermList } from "./ui";

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
  const [unassignedCount, setUnassignedCount] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [showAssigned, setShowAssigned] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [picking, setPicking] = useState<UnassignedEntry | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [processing, setProcessing] = useState(false);
  // まとめて事業利用にする科目と按分（空 = 科目の事業利用按分の割合）
  const [bulkPicking, setBulkPicking] = useState(false);
  const [bulkAccount, setBulkAccount] = useState<Account | null>(null);
  const [bulkRatio, setBulkRatio] = useState("");
  const mode = getViewMode();

  const load = useCallback(async () => {
    try {
      const res = await fetchUnassignedEntries(year, month, showAssigned);
      setEntries(res.data);
      setUnassignedCount(res.unassignedCount);
      setTruncated(res.truncated);
    } catch {
      setEntries([]);
    }
  }, [year, month, showAssigned]);

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

  // 科目・事業利用の変更。付けたものは学習ルールに覚える
  function change(e: UnassignedEntry, c: EntryChange) {
    run(async () => {
      const { updatedSiblingCount: n } = await categorizeEntry(e.kind, e.id, c);
      return n > 0 ? `同じ摘要の未割り当ての明細 ${n} 件にも同じ科目を付けました。` : null;
    });
  }

  function bulkBusiness() {
    if (!bulkAccount) return;
    const ratio = bulkRatio.trim() === "" ? null : Number(bulkRatio);
    if (ratio !== null && !isValidBusinessRatio(ratio)) {
      setMsg({ ok: false, text: "按分は 0 より大きく 100 以下で入れてください" });
      return;
    }
    run(async () => {
      const r = await setMonthBusinessUse({
        year,
        month,
        categoryAccountId: bulkAccount.id,
        businessRatio: ratio,
      });
      return (
        `${r.updated} 件の明細を事業利用にしました。` +
        (r.locked > 0 ? `（実績を確定済みの月の ${r.locked} 件はそのままです）` : "")
      );
    });
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
        {showAssigned ? "明細" : "未割り当ての明細"}（{month}月・未割り当て {unassignedCount} 件）
      </Text>
      <Text style={s.note}>{ENTRY_HELP.unassigned}</Text>
      <Text style={s.note}>{ENTRY_HELP.businessUse}</Text>
      <View style={s.switchRow}>
        <Switch
          value={showAssigned}
          onValueChange={setShowAssigned}
          accessibilityLabel="割り当て済みも表示"
        />
        <Text style={s.switchLabel}>割り当て済みも表示</Text>
      </View>
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
      <View style={s.bulkRow}>
        <Text style={s.switchLabel}>{month}月の</Text>
        <TouchableOpacity onPress={() => setBulkPicking(true)}>
          <Text style={s.link}>
            {bulkAccount ? `${bulkAccount.code} ${displayName(bulkAccount, mode)}` : "科目を選ぶ"}
          </Text>
        </TouchableOpacity>
        <Text style={s.switchLabel}>の明細を、按分</Text>
        <Input
          value={bulkRatio}
          onChangeText={setBulkRatio}
          keyboardType="decimal-pad"
          placeholder="既定"
          accessibilityLabel="まとめて付ける按分（%）"
          style={s.ratio}
        />
        <Text style={s.switchLabel}>%で</Text>
        <Button
          label={`まとめて${BUSINESS_USE_LABEL}にする`}
          small
          variant="secondary"
          disabled={!bulkAccount}
          onPress={bulkBusiness}
        />
      </View>
      {truncated && <Text style={s.note}>明細が多いため、先頭の 500 件だけを表示しています。</Text>}
      {entries === null ? (
        <ActivityIndicator color={COLORS.primary} style={{ marginVertical: 12 }} />
      ) : entries.length === 0 ? (
        <Text style={s.done}>
          {showAssigned
            ? `${month}月の明細はありません。`
            : `${month}月の明細には、すべて科目が付いています。`}
        </Text>
      ) : (
        entries.map((e) => (
          <LedgerRow
            key={`${e.kind}${e.id}`}
            date={fmtDate(e.date)}
            account={`${KIND_LABEL[e.kind]}・${e.sourceName}`}
            description={e.description}
            amount={yenAbs(e.amount)}
            // 明細の金額は入金が正（カードの利用も出金として負）
            tone={flowSide("bank", e.amount)}
            directionLabel={flowLabel("bank", e.amount)}
            category={
              <TouchableOpacity onPress={() => setPicking(e)}>
                <Text style={s.link}>
                  {e.categoryAccount
                    ? `${e.categoryAccount.code} ${displayName(e.categoryAccount, mode)}`
                    : "科目を選ぶ"}
                </Text>
              </TouchableOpacity>
            }
            status={
              <BusinessRatioControl
                businessUse={e.businessUse}
                businessRatio={e.businessRatio}
                onChange={(c) => change(e, c)}
              />
            }
          />
        ))
      )}

      <CategoryPickerModal
        visible={picking !== null}
        accounts={accounts}
        description={picking?.description}
        currentId={picking?.categoryAccountId ?? null}
        onSelect={(id) => {
          const e = picking;
          setPicking(null);
          if (e && id !== null) change(e, { categoryAccountId: id });
        }}
        onClose={() => setPicking(null)}
      />
      <CategoryPickerModal
        visible={bulkPicking}
        accounts={accounts}
        description="まとめて事業利用にする科目"
        currentId={bulkAccount?.id ?? null}
        onSelect={(id) => {
          setBulkPicking(false);
          setBulkAccount(accounts.find((a) => a.id === id) ?? null);
        }}
        onClose={() => setBulkPicking(false)}
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
  switchRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 8 },
  switchLabel: { fontSize: 12, color: "#374151" },
  bulkRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    gap: 6,
    marginBottom: 8,
  },
  ratio: { width: 64, paddingVertical: 4, fontSize: 12 },
});
