// 予算配分（web 版 components/BudgetAllocationPanel.tsx と同じ構成）。予算画面の「予算配分」タブから使う。
//   1. 予算配分ルール … 収入に対する各項目の割当割合（%）のマスタ。FP 推奨の既定ルールを取り込める。
//   2. 配分提案 … 収入額に割合を掛けた推奨額（計算はサーバー側）。予算へ一括反映できる。
//      既定の「手入力」は入力額をそのまま振り分ける（ローン等の控除なし）。
import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  ALLOCATION_GROUPS,
  applyAllocationToBudget,
  fetchAllocationRules,
  fetchAllocationSuggestion,
  importDefaultAllocationRules,
  saveAllocationRules,
  type Account,
  type AllocationBasis,
  type AllocationRule,
  type AllocationSuggestion,
  type ViewMode,
} from "../api";
import { displayName } from "../shared/display-name";
import { digitsOnly, MONTHS, yen } from "../format";
import { AccountPickerModal } from "./CategoryPickerModal";
import { Button, Card, EmptyText, Field, Input, Notice, Pills, SectionTitle } from "./ui";

type RuleEdit = {
  origKey: string | null; // null = 新規（保存前）
  key: string;
  label: string;
  group: string;
  minPercent: string;
  maxPercent: string; // 空 = 上限なし
  note: string;
  accountCode: string; // 空 = 未紐付け
};

const toEdit = (r: AllocationRule): RuleEdit => ({
  origKey: r.key,
  key: r.key,
  label: r.label,
  group: r.group,
  minPercent: String(r.minPercent),
  maxPercent: r.maxPercent === null ? "" : String(r.maxPercent),
  note: r.note ?? "",
  accountCode: r.account?.code ?? "",
});

// 新規行の key は英数字で一意にする必要があるため、タイムスタンプで採番する
const newRuleKey = () => `rule_${Date.now().toString(36)}`;

type Message = { ok: boolean; text: string } | null;

function AllocationRulesSection({
  accounts,
  viewMode,
}: {
  accounts: Account[];
  viewMode: ViewMode;
}) {
  const [rules, setRules] = useState<RuleEdit[]>([]);
  const [removedKeys, setRemovedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState<Message>(null);
  const [pickingIndex, setPickingIndex] = useState<number | null>(null);

  useEffect(() => {
    fetchAllocationRules()
      .then((rs) => setRules(rs.map(toEdit)))
      .catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }))
      .finally(() => setLoading(false));
  }, []);

  const setField = (index: number, field: keyof RuleEdit, value: string) =>
    setRules((rs) => rs.map((r, i) => (i === index ? { ...r, [field]: value } : r)));

  const addRule = () =>
    setRules((rs) => [
      ...rs,
      {
        origKey: null,
        key: newRuleKey(),
        label: "",
        group: ALLOCATION_GROUPS[0],
        minPercent: "0",
        maxPercent: "",
        note: "",
        accountCode: "",
      },
    ]);

  const removeRule = (index: number) =>
    setRules((rs) => {
      const target = rs[index];
      if (target.origKey) setRemovedKeys((keys) => [...keys, target.origKey!]);
      return rs.filter((_, i) => i !== index);
    });

  async function loadDefaults() {
    setSeeding(true);
    setMsg(null);
    try {
      const { rules: rs, created } = await importDefaultAllocationRules();
      setRules(rs.map(toEdit));
      setRemovedKeys([]);
      setMsg({
        ok: true,
        text:
          created > 0
            ? `推奨ルールを ${created} 件追加しました。`
            : "推奨ルールはすべて登録済みです。",
      });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) });
    } finally {
      setSeeding(false);
    }
  }

  async function save() {
    const items = rules.map((r) => ({
      key: r.key.trim(),
      label: r.label.trim(),
      group: r.group,
      minPercent: Number(r.minPercent) || 0,
      maxPercent: r.maxPercent.trim() === "" ? null : Number(r.maxPercent),
      note: r.note.trim() === "" ? null : r.note.trim(),
      accountCode: r.accountCode === "" ? null : r.accountCode,
    }));
    if (items.some((i) => !i.key || !i.label)) {
      setMsg({ ok: false, text: "項目名（ラベル）が未入力の行があります。" });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      setRules((await saveAllocationRules(items, removedKeys)).map(toEdit));
      setRemovedKeys([]);
      setMsg({ ok: true, text: "予算配分ルールを保存しました。" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存に失敗しました。" });
    } finally {
      setSaving(false);
    }
  }

  const accountLabel = (code: string) => {
    const a = accounts.find((x) => x.code === code);
    return a ? `${a.code} ${displayName(a, viewMode)}` : "— 未紐付け —";
  };

  return (
    <Card>
      <SectionTitle
        note={
          "収入に対する各項目の割当割合（%）です。初期値はファイナンシャルプランナーが推奨する配分" +
          "（50/30/20 ルールに沿った目安）です。対応科目を紐付けると、下の「配分提案」から推奨額を" +
          "その科目の予算へ一括反映でき、明細一覧にも「適正 ¥…」として表示されます。"
        }
      >
        予算配分ルール
      </SectionTitle>
      <View style={s.actions}>
        <Button small label="変更を保存" onPress={save} loading={saving} />
        <Button
          small
          variant="link"
          label={seeding ? "取り込み中…" : "推奨ルールを取り込む"}
          onPress={loadDefaults}
          disabled={seeding}
        />
      </View>
      {msg && <Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice>}

      {loading ? (
        <EmptyText>読み込み中…</EmptyText>
      ) : (
        rules.map((r, i) => (
          <View key={r.origKey ?? `new-${r.key}`} style={s.rule}>
            <View style={s.ruleHead}>
              <Pills
                scroll={false}
                options={ALLOCATION_GROUPS.map((g) => ({ value: g as string, label: g }))}
                value={r.group}
                onChange={(g) => setField(i, "group", g)}
              />
              <TouchableOpacity onPress={() => removeRule(i)} hitSlop={8}>
                <Text style={s.remove}>削除</Text>
              </TouchableOpacity>
            </View>
            <Field label="ラベル">
              <Input
                value={r.label}
                placeholder={r.origKey ? undefined : "例: 貯蓄・投資"}
                onChangeText={(t) => setField(i, "label", t)}
              />
            </Field>
            <View style={s.percentRow}>
              <View style={{ flex: 1 }}>
                <Field label="下限%">
                  <Input
                    keyboardType="decimal-pad"
                    value={r.minPercent}
                    onChangeText={(t) => setField(i, "minPercent", t)}
                  />
                </Field>
              </View>
              <View style={{ flex: 1 }}>
                <Field label="上限%">
                  <Input
                    keyboardType="decimal-pad"
                    value={r.maxPercent}
                    placeholder="上限なし"
                    onChangeText={(t) => setField(i, "maxPercent", t)}
                  />
                </Field>
              </View>
            </View>
            <Field label="対応科目">
              <TouchableOpacity style={s.picker} onPress={() => setPickingIndex(i)}>
                <Text style={s.pickerText} numberOfLines={1}>
                  {accountLabel(r.accountCode)}
                </Text>
              </TouchableOpacity>
            </Field>
            <Field label="補足">
              <Input value={r.note} onChangeText={(t) => setField(i, "note", t)} />
            </Field>
          </View>
        ))
      )}
      <Button small variant="link" label="+ ルールを追加" onPress={addRule} />

      <AccountPickerModal
        visible={pickingIndex !== null}
        accounts={accounts}
        title="対応科目を選択"
        clearLabel="— 未紐付け —"
        currentId={
          pickingIndex !== null
            ? (accounts.find((a) => a.code === rules[pickingIndex]?.accountCode)?.id ?? null)
            : null
        }
        onSelect={(a) => {
          if (pickingIndex !== null) setField(pickingIndex, "accountCode", a?.code ?? "");
          setPickingIndex(null);
        }}
        onClose={() => setPickingIndex(null)}
      />
    </Card>
  );
}

const BASIS_OPTIONS: { value: AllocationBasis; label: string }[] = [
  { value: "manual", label: "手入力" },
  { value: "actual", label: "実績（収入）" },
  { value: "budget", label: "予算（収入）" },
];

function AllocationSuggestSection({
  fiscalYear,
  accounts,
  viewMode,
  onApplied,
}: {
  fiscalYear: number;
  accounts: Account[];
  viewMode: ViewMode;
  onApplied: () => void;
}) {
  const now = new Date();
  const [year, setYear] = useState(fiscalYear);
  const [month, setMonth] = useState(now.getMonth() + 1);
  // 既定は「手入力」。予算・実績の入力状況に左右されず、入れた金額をそのまま振り分けられる
  const [basis, setBasis] = useState<AllocationBasis>("manual");
  const [incomeInput, setIncomeInput] = useState("");
  // 手入力は「配分を算出」を押したときだけ問い合わせる（打鍵のたびに再計算しない）
  const [committedIncome, setCommittedIncome] = useState<number | null>(null);
  const [data, setData] = useState<AllocationSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (basis === "manual" && committedIncome === null) {
      setData(null);
      return;
    }
    setLoading(true);
    fetchAllocationSuggestion({ year, month, basis, amount: committedIncome ?? 0 })
      .then((d) => {
        setData(d);
        setAmounts(Object.fromEntries(d.items.map((i) => [i.rule.id, String(i.recommended)])));
      })
      .catch((e) => setMessage(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [year, month, basis, committedIncome]);

  async function apply() {
    if (!data) return;
    const items = data.items
      .filter((i) => i.rule.accountId !== null)
      .map((i) => ({
        accountId: i.rule.accountId as number,
        month,
        amount: Number(amounts[i.rule.id] ?? i.recommended),
      }))
      .filter((i) => i.amount > 0);
    if (items.length === 0) {
      setMessage("反映する科目がありません（配分ルールに対応科目が未設定です）");
      return;
    }
    setApplying(true);
    setMessage(null);
    try {
      await applyAllocationToBudget(year, items);
      setMessage(`${items.length} 件の科目に予算を反映しました。`);
      onApplied();
    } catch (e) {
      setMessage(`エラー: ${e instanceof Error ? e.message : "反映に失敗しました"}`);
    } finally {
      setApplying(false);
    }
  }

  const availableLabel = data?.basis === "manual" ? "配分対象額" : "配分可能額（ローン等控除後）";
  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i);

  return (
    <Card>
      <SectionTitle
        note={
          `収入額に上のルールの割合を掛けた推奨額です。${year}年度の予算へ一括反映できます。` +
          "反映しなくても、明細一覧には「適正 ¥…」として表示されます。" +
          (basis === "manual"
            ? "手入力では、入力した金額だけを純粋に割合で振り分けます（予算・実績やローン返済などは考慮しません）。"
            : "実績・予算では、その月の収入からローン返済・実物資産の負債分を差し引いた「配分可能額」をもとに算出します。")
        }
      >
        配分提案
      </SectionTitle>

      <Field label="年度">
        <Pills
          options={years.map((y) => ({ value: y, label: `${y}年度` }))}
          value={year}
          onChange={setYear}
        />
      </Field>
      <Field label="対象月">
        <Pills
          options={MONTHS.map((m) => ({ value: m, label: `${m}月` }))}
          value={month}
          onChange={setMonth}
        />
      </Field>
      <Field label="収入基準額">
        <Pills
          scroll={false}
          options={BASIS_OPTIONS}
          value={basis}
          onChange={(b) => {
            setBasis(b);
            setCommittedIncome(null);
          }}
        />
      </Field>
      {basis === "manual" && (
        <View style={s.incomeRow}>
          <View style={{ flex: 1 }}>
            <Field label="収入金額（円）">
              <Input
                keyboardType="number-pad"
                value={incomeInput}
                placeholder="例: 450000"
                onChangeText={(t) => setIncomeInput(digitsOnly(t))}
              />
            </Field>
          </View>
          <Button
            label="配分を算出"
            disabled={incomeInput === ""}
            onPress={() => setCommittedIncome(Number(incomeInput))}
            style={{ marginBottom: 10 }}
          />
        </View>
      )}

      {basis === "manual" && committedIncome === null && (
        <Text style={s.hint}>
          収入金額を入力して「配分を算出」を押すと、その金額をもとに各項目の割当額を計算します。
        </Text>
      )}
      {loading && <EmptyText>計算中…</EmptyText>}

      {data && !loading && (
        <>
          <View style={s.basisBox}>
            <Text style={s.basisText}>
              収入基準額: <Text style={s.basisStrong}>{yen(data.basisAmount)}</Text>
            </Text>
            {/* 手入力は控除しないので基準額＝配分額。二重表示を避けて振り分け対象額だけ出す */}
            <Text style={s.basisText}>
              {availableLabel}: <Text style={s.basisPrimary}>{yen(data.available)}</Text>
            </Text>
          </View>

          {data.overRecommended && (
            <Notice tone="warn">
              ⚠ 推奨額の合計（{yen(data.totalRecommended)}）が
              {data.basis === "manual" ? "配分対象額" : "配分可能額"}（{yen(data.available)}
              ）を超えています。金額を調整してください。
            </Notice>
          )}

          <View style={s.summaryRow}>
            {(
              [
                ["固定費", data.summary503020.needs],
                ["生活費", data.summary503020.wants],
                ["その他・貯蓄", data.summary503020.savings],
              ] as [string, number][]
            ).map(([label, value]) => (
              <View key={label} style={s.summaryCell}>
                <Text style={s.summaryLabel}>{label}</Text>
                <Text style={s.summaryValue}>{yen(value)}</Text>
              </View>
            ))}
          </View>

          {data.items.map((item) => {
            const acct = accounts.find((a) => a.id === item.rule.accountId);
            const linked = item.rule.accountId !== null;
            return (
              <View key={item.rule.id} style={s.item}>
                <View style={{ flex: 1 }}>
                  <Text style={s.itemLabel}>
                    {item.rule.label} <Text style={s.itemGroup}>{item.rule.group}</Text>
                  </Text>
                  <Text style={s.itemMeta}>
                    {acct ? `${acct.code} ${displayName(acct, viewMode)}` : "—未紐付け—"}
                  </Text>
                  <Text style={s.itemMeta}>
                    目安 {yen(item.min)}
                    {item.max !== null ? ` 〜 ${yen(item.max)}` : " 〜"}
                  </Text>
                </View>
                <Input
                  keyboardType="number-pad"
                  editable={linked}
                  value={amounts[item.rule.id] ?? ""}
                  onChangeText={(t) => setAmounts({ ...amounts, [item.rule.id]: digitsOnly(t) })}
                  style={[s.amountInput, !linked && s.amountInputDisabled]}
                />
              </View>
            );
          })}
          {data.items.some((i) => i.rule.accountId === null) && (
            <Text style={s.hint}>
              対応科目が未設定の項目は反映できません（上のルールで紐付けてください）。
            </Text>
          )}

          <Button
            label={applying ? "反映中…" : `${month}月の予算へ一括反映`}
            onPress={apply}
            loading={applying}
            style={{ marginTop: 10 }}
          />
        </>
      )}
      {message && <Text style={s.message}>{message}</Text>}
    </Card>
  );
}

export function BudgetAllocationPanel({
  fiscalYear,
  accounts,
  viewMode,
  onApplied,
}: {
  fiscalYear: number;
  accounts: Account[];
  viewMode: ViewMode;
  /** 予算への反映後に呼ぶ（呼び出し側で予算・履歴・適正額を取り直す） */
  onApplied: () => void;
}) {
  return (
    <>
      <AllocationRulesSection accounts={accounts} viewMode={viewMode} />
      <AllocationSuggestSection
        fiscalYear={fiscalYear}
        accounts={accounts}
        viewMode={viewMode}
        onApplied={onApplied}
      />
    </>
  );
}

const s = StyleSheet.create({
  actions: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 10 },
  rule: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 10,
    padding: 10,
    marginBottom: 10,
    backgroundColor: "#f8fafc",
  },
  ruleHead: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6,
  },
  remove: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
  percentRow: { flexDirection: "row", gap: 10 },
  picker: {
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: "#fff",
  },
  pickerText: { fontSize: 14, color: "#1e293b" },
  incomeRow: { flexDirection: "row", alignItems: "flex-end", gap: 10 },
  hint: { fontSize: 12, color: "#94a3b8", marginBottom: 8 },
  basisBox: { alignItems: "flex-end", marginBottom: 10 },
  basisText: { fontSize: 12, color: "#475569" },
  basisStrong: { fontWeight: "700" },
  basisPrimary: { fontWeight: "700", color: "#4338ca" },
  summaryRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  summaryCell: {
    flex: 1,
    backgroundColor: "#f8fafc",
    borderRadius: 8,
    paddingVertical: 8,
    alignItems: "center",
  },
  summaryLabel: { fontSize: 10, color: "#64748b" },
  summaryValue: { fontSize: 13, fontWeight: "700", color: "#334155", marginTop: 2 },
  item: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f1f5f9",
  },
  itemLabel: { fontSize: 13, color: "#1e293b" },
  itemGroup: { fontSize: 10, color: "#94a3b8" },
  itemMeta: { fontSize: 10, color: "#64748b", marginTop: 2 },
  amountInput: { width: 110, textAlign: "right" },
  amountInputDisabled: { backgroundColor: "#f8fafc", color: "#94a3b8" },
  message: { fontSize: 12, color: "#475569", marginTop: 8 },
});
