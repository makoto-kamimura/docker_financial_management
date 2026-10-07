// 実績の画面の履歴（出どころは銀行）に置く「毎月の入出金」（web 版 TransferRulesCard と振替紐付けと同じ）。
// 銀行の画面の資金移動スケジュールから移した。資金移動ルールの一覧と解除、振替（銀行 → 銀行）の登録、
// 取込済み明細の振替紐付けを行う。ルールは明細の「固定入出金」や毎月の入出金の候補から登録する。
import { useCallback, useEffect, useState } from "react";
import { Alert, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  deleteTransfer,
  fetchTransferCandidates,
  fetchTransferFlow,
  linkBankTransfer,
  postBankTransfer,
  type BankAccount,
  type TransferCandidate,
  type TransferFlowResponse,
} from "../../api";
import { digitsOnly, fmtDate, yen } from "../../format";
import { BANK_HELP } from "../../shared/help-texts";
import {
  Button,
  Card,
  Field,
  Input,
  Notice,
  Pills,
  SectionTitle,
  SelectField,
  SheetModal,
} from "../ui";

const DAY_GAP_OPTIONS = [0, 1, 3, 7] as const;

type Props = {
  accounts: BankAccount[];
  /** 選んだ銀行。null はすべての銀行 */
  accountId: number | null;
  /** 残高が変わる操作（振替の登録・紐付け）の後に呼ぶ */
  onBalanceChanged: () => void;
};

export function TransferRules({ accounts, accountId, onBalanceChanged }: Props) {
  const [flow, setFlow] = useState<TransferFlowResponse | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [showBankTransfer, setShowBankTransfer] = useState(false);

  const loadRules = useCallback(async () => {
    try {
      setFlow(await fetchTransferFlow());
    } catch (e) {
      setMsg(e instanceof Error ? e.message : "毎月の入出金の取得に失敗しました");
    }
  }, []);

  useEffect(() => {
    loadRules();
  }, [loadRules]);

  // 選んだ銀行が関わるルールだけを出す（web 版と同じ）
  const rows = (flow?.transfers ?? []).filter(
    (t) => accountId === null || t.fromAccountId === accountId || t.toAccountId === accountId,
  );

  function confirmDelete(t: TransferFlowResponse["transfers"][number]) {
    const name = t.label ?? `${t.from ?? "外部"} → ${t.to ?? "外部"}`;
    Alert.alert(
      "毎月の入出金の解除",
      `毎月${t.day}日の「${name}」の登録を解除します。明細はそのまま残ります。`,
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "解除",
          style: "destructive",
          onPress: async () => {
            try {
              await deleteTransfer(t.id);
              setMsg("毎月の入出金の登録を解除しました。");
              loadRules();
              onBalanceChanged();
            } catch (e) {
              setMsg(e instanceof Error ? e.message : "解除に失敗しました");
            }
          },
        },
      ],
    );
  }

  return (
    <View>
      {msg && (
        <TouchableOpacity onPress={() => setMsg(null)}>
          <Notice>{msg}　✕</Notice>
        </TouchableOpacity>
      )}

      <SectionTitle note={BANK_HELP.schedule}>毎月の入出金</SectionTitle>
      <Button
        label="振替を登録（銀行 → 銀行）"
        disabled={accounts.length < 2}
        onPress={() => setShowBankTransfer(true)}
        style={{ marginBottom: 10 }}
      />
      {accounts.length < 2 && <Text style={s.muted}>振替には 2 つ以上の口座の登録が必要です</Text>}
      {!flow ? null : rows.length === 0 ? (
        <Text style={s.muted}>
          毎月の入出金はまだ登録されていません。下の明細の「固定入出金」や、毎月の入出金の候補から登録できます。
        </Text>
      ) : (
        <Card>
          {rows.map((t) => (
            <View key={t.id} style={s.ruleRow}>
              <Text style={s.ruleDay}>{t.day}日</Text>
              <View style={{ flex: 1 }}>
                <Text style={s.ruleRoute} numberOfLines={2}>
                  <Text style={t.from ? undefined : s.external}>
                    {t.from ?? t.label ?? "外部入金"}
                  </Text>
                  {" → "}
                  <Text style={t.to ? undefined : s.externalOut}>
                    {t.to ?? t.label ?? "外部支出"}
                  </Text>
                </Text>
                <Text style={s.muted}>{t.channelLabel}</Text>
              </View>
              <Text style={s.ruleAmount}>{yen(t.amount)}</Text>
              <TouchableOpacity onPress={() => confirmDelete(t)} hitSlop={8}>
                <Text style={s.danger}>解除</Text>
              </TouchableOpacity>
            </View>
          ))}
        </Card>
      )}

      <TransferMatchPanel
        onLinked={(text) => {
          setMsg(text);
          onBalanceChanged();
        }}
        onError={setMsg}
      />

      <BankTransferSheet
        visible={showBankTransfer}
        accounts={accounts}
        onClose={() => setShowBankTransfer(false)}
        onDone={(text) => {
          setMsg(text);
          onBalanceChanged();
        }}
      />
    </View>
  );
}

function TransferMatchPanel({
  onLinked,
  onError,
}: {
  onLinked: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const [dayGap, setDayGap] = useState(3);
  const [data, setData] = useState<{ data: TransferCandidate[]; total: number } | null>(null);
  const [linking, setLinking] = useState<string | null>(null);

  const load = useCallback(() => {
    setData(null);
    fetchTransferCandidates(dayGap)
      .then(setData)
      .catch(() => setData({ data: [], total: 0 }));
  }, [dayGap]);

  useEffect(() => {
    load();
  }, [load]);

  function link(c: TransferCandidate) {
    const hasCategory = c.out.categoryAccountId !== null || c.in.categoryAccountId !== null;
    Alert.alert(
      "振替として紐付け",
      `出金 ${fmtDate(c.out.date)} ${c.out.accountName}（${c.out.description}）\n` +
        `入金 ${fmtDate(c.in.date)} ${c.in.accountName}（${c.in.description}）\n金額 ${yen(c.amount)}\n\n` +
        "紐付けると収入・支出には計上されなくなります（口座残高は変わりません）。" +
        (hasCategory ? "\n付いている科目の紐付けは解除されます。" : ""),
      [
        { text: "キャンセル", style: "cancel" },
        {
          text: "紐付ける",
          onPress: async () => {
            const key = `${c.out.id}-${c.in.id}`;
            setLinking(key);
            try {
              await linkBankTransfer(c.out.id, c.in.id);
              onLinked("振替として紐付けました。両方の明細が収入・支出の集計から外れます。");
              load();
            } catch (e) {
              onError(`紐付けに失敗しました: ${e instanceof Error ? e.message : "エラー"}`);
            } finally {
              setLinking(null);
            }
          },
        },
      ],
    );
  }

  return (
    <Card>
      <View style={s.matchHead}>
        <Text style={s.formTitle}>取込済み明細の振替紐付け</Text>
      </View>
      <Text style={s.help}>{BANK_HELP.transferMatch}</Text>
      <Field label="日付のずれ">
        <Pills
          scroll={false}
          options={DAY_GAP_OPTIONS.map((d) => ({
            value: d as number,
            label: d === 0 ? "同じ日のみ" : `${d}日以内`,
          }))}
          value={dayGap}
          onChange={setDayGap}
        />
      </Field>
      {data === null ? (
        <Text style={s.muted}>候補を探しています…</Text>
      ) : data.data.length === 0 ? (
        <Text style={s.muted}>
          振替の対になりそうな明細は見つかりませんでした。着金が数日ずれている場合は「日付のずれ」を広げてみてください。
        </Text>
      ) : (
        <>
          <Text style={s.muted}>
            同額・符号が逆・別口座の明細の組です（{data.total} 件
            {data.total > data.data.length ? `のうち ${data.data.length} 件を表示` : ""}
            ）。機械的な突き合わせなので、内容を確かめてから紐付けてください。
          </Text>
          {data.data.map((c) => {
            const key = `${c.out.id}-${c.in.id}`;
            return (
              <View key={key} style={s.matchRow}>
                <View style={{ flex: 1 }}>
                  <Text style={s.matchSide}>
                    出金 {fmtDate(c.out.date)}・{c.out.accountName}
                  </Text>
                  <Text style={s.dayLabel} numberOfLines={1}>
                    {c.out.description}
                  </Text>
                  <Text style={s.matchSide}>
                    入金 {fmtDate(c.in.date)}・{c.in.accountName}
                  </Text>
                  <Text style={s.dayLabel} numberOfLines={1}>
                    {c.in.description}
                  </Text>
                </View>
                <View style={{ alignItems: "flex-end", gap: 4 }}>
                  <Text style={s.ruleAmount}>{yen(c.amount)}</Text>
                  <Text style={s.muted}>{c.dayGap === 0 ? "同じ日" : `${c.dayGap}日`}</Text>
                  <Button
                    small
                    variant="secondary"
                    label={linking === key ? "紐付け中…" : "振替として紐付ける"}
                    disabled={linking !== null}
                    onPress={() => link(c)}
                  />
                </View>
              </View>
            );
          })}
        </>
      )}
    </Card>
  );
}

// ── 都度の振替（銀行 → 銀行）。出金元・入金先の両方に明細を作る ───────────────
function BankTransferSheet({
  visible,
  accounts,
  onClose,
  onDone,
}: {
  visible: boolean;
  accounts: BankAccount[];
  onClose: () => void;
  onDone: (msg: string) => void;
}) {
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    fromAccountId: null as number | null,
    toAccountId: null as number | null,
    amount: "",
    description: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function submit() {
    if (!form.fromAccountId || !form.toAccountId)
      return setError("出金元と入金先の口座を選択してください。");
    if (form.fromAccountId === form.toAccountId)
      return setError("出金元と入金先が同じです。別の口座を選択してください。");
    if (!(Number(form.amount) > 0)) return setError("金額を入力してください。");
    setSaving(true);
    setError(null);
    try {
      await postBankTransfer({
        date: form.date,
        fromAccountId: form.fromAccountId,
        toAccountId: form.toAccountId,
        amount: Number(form.amount),
        description: form.description || null,
      });
      // 日付は続けて登録しやすいよう残す
      setForm((f) => ({
        ...f,
        fromAccountId: null,
        toAccountId: null,
        amount: "",
        description: "",
      }));
      onDone("振替を登録しました。出金元・入金先の両方の明細に反映されます。");
      onClose();
    } catch (e) {
      setError(`振替の登録に失敗しました: ${e instanceof Error ? e.message : "エラー"}`);
    } finally {
      setSaving(false);
    }
  }

  const options = accounts.map((a) => ({ value: a.id, label: `${a.name}（${a.bankName}）` }));
  return (
    <SheetModal
      visible={visible}
      title="振替を登録（銀行 → 銀行）"
      subtitle="両方の口座に明細を作ります。自己資金の移動なので収入・支出には計上されません。"
      onClose={onClose}
      footer={<Button label="振替を登録" onPress={submit} loading={saving} />}
    >
      <Field label="日付（YYYY-MM-DD）">
        <Input value={form.date} onChangeText={(date) => setForm((f) => ({ ...f, date }))} />
      </Field>
      <SelectField
        label="出金元の口座"
        value={form.fromAccountId}
        options={options}
        onChange={(id) => setForm((f) => ({ ...f, fromAccountId: id }))}
      />
      <SelectField
        label="入金先の口座"
        value={form.toAccountId}
        options={options.filter((o) => o.value !== form.fromAccountId)}
        onChange={(id) => setForm((f) => ({ ...f, toAccountId: id }))}
      />
      <Field label="金額（円）">
        <Input
          keyboardType="number-pad"
          value={form.amount}
          placeholder="例: 50000"
          onChangeText={(t) => setForm((f) => ({ ...f, amount: digitsOnly(t) }))}
        />
      </Field>
      <Field label="摘要（任意）">
        <Input
          value={form.description}
          placeholder="未入力なら相手口座名から自動作成"
          onChangeText={(description) => setForm((f) => ({ ...f, description }))}
        />
      </Field>
      {error && <Notice tone="error">{error}</Notice>}
    </SheetModal>
  );
}

const s = StyleSheet.create({
  danger: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
  muted: { fontSize: 11, color: "#94a3b8", marginBottom: 8, lineHeight: 16 },
  help: { fontSize: 11, color: "#475569", lineHeight: 17, marginBottom: 8 },
  scheduleHead: { marginBottom: 8 },
  ruleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  ruleDay: { fontSize: 12, color: "#64748b", width: 32 },
  ruleRoute: { fontSize: 13, color: "#334155" },
  external: { color: "#059669", fontWeight: "600" },
  externalOut: { color: "#e11d48", fontWeight: "600" },
  ruleAmount: { fontSize: 13, fontWeight: "700", color: "#1e293b" },
  monthNav: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  navBtn: { padding: 8 },
  navTxt: { fontSize: 14, color: "#4f46e5" },
  monthLabel: { fontSize: 15, fontWeight: "700", color: "#1e293b" },
  weekRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#f1f5f9" },
  weekCell: { flex: 1, textAlign: "center", fontSize: 11, color: "#64748b", paddingVertical: 6 },
  sun: { color: "#ef4444" },
  sat: { color: "#3b82f6" },
  grid: { flexDirection: "row", flexWrap: "wrap" },
  dayCell: {
    width: `${100 / 7}%`,
    minHeight: 60,
    padding: 3,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: "#f1f5f9",
  },
  dayBlank: { backgroundColor: "#fafafa" },
  daySelected: { backgroundColor: "#eef2ff" },
  dayNum: { fontSize: 12, fontWeight: "600", color: "#334155" },
  dayOut: { fontSize: 8, color: "#e11d48" },
  dayIn: { fontSize: 8, color: "#059669" },
  dayMore: { fontSize: 8, color: "#94a3b8" },
  dayTitle: { fontSize: 14, fontWeight: "700", color: "#1e293b" },
  dayRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 8,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  dayLabel: { fontSize: 13, color: "#1e293b" },
  out: { fontSize: 12, fontWeight: "700", color: "#e11d48" },
  in: { fontSize: 12, fontWeight: "700", color: "#059669" },
  remove: { fontSize: 13, color: "#cbd5e1", paddingHorizontal: 4 },
  formTitle: { fontSize: 13, fontWeight: "700", color: "#475569", marginBottom: 8 },
  matchHead: { flexDirection: "row", alignItems: "center", gap: 6 },
  matchRow: {
    flexDirection: "row",
    gap: 10,
    paddingVertical: 10,
    borderTopWidth: 1,
    borderTopColor: "#f1f5f9",
  },
  matchSide: { fontSize: 10, color: "#64748b", marginTop: 2 },
});
