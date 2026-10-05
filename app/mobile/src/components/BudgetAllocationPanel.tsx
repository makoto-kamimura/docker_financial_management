// 予算配分（web 版 components/BudgetAllocationPanel.tsx と同じ構成）。予算画面の「設定」タブ（右端）から使う。
//   1. 予算配分ルール … 収入に対する各項目の割当割合（%）のマスタ。FP 推奨の既定ルールを取り込める。
//      科目は科目名のキーワードと受け皿の区分で自動で振り分ける（ここでは表示のみ。移すのは web 版）。
//   2. 配分提案 … 収入額に割合を掛けた推奨額（計算はサーバー側）。予算が未設定の科目にだけ、
//      入っている予算を差し引いた残りを前の 3 か月の実績の比率で按分して反映する。
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
  type AllocationBasis,
  type AllocationRule,
  type AllocationSuggestion,
  type ViewMode,
} from "../api";
import { displayName } from "../shared/display-name";
import { digitsOnly, MONTHS, yen } from "../format";
import { Button, Card, EmptyText, Field, Input, Notice, Pills, SectionTitle } from "./ui";
import { BUDGET_HELP } from "../shared/help-texts";
import { planAllocationApply } from "../shared/allocation-assign";

type RuleEdit = {
  origKey: string | null; // null = 新規（保存前）
  key: string;
  label: string;
  group: string;
  minPercent: string;
  maxPercent: string; // 空 = 上限なし
  note: string;
  keywords: string; // 読点・カンマ区切り
  members: AllocationRule["accounts"]; // 保存済みの内容で振り分けた科目（表示のみ）
};

const parseKeywords = (text: string) => [
  ...new Set(
    text
      .split(/[、,，\s]+/)
      .map((k) => k.trim())
      .filter(Boolean),
  ),
];

const toEdit = (r: AllocationRule): RuleEdit => ({
  origKey: r.key,
  key: r.key,
  label: r.label,
  group: r.group,
  minPercent: String(r.minPercent),
  maxPercent: r.maxPercent === null ? "" : String(r.maxPercent),
  note: r.note ?? "",
  keywords: r.keywords.join("、"),
  members: r.accounts,
});

// 新規行の key は英数字で一意にする必要があるため、タイムスタンプで採番する
const newRuleKey = () => `rule_${Date.now().toString(36)}`;

type Message = { ok: boolean; text: string } | null;

function AllocationRulesSection({ viewMode }: { viewMode: ViewMode }) {
  const [rules, setRules] = useState<RuleEdit[]>([]);
  const [removedKeys, setRemovedKeys] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState<Message>(null);

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
        keywords: "",
        members: [],
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
      keywords: parseKeywords(r.keywords),
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

  return (
    <Card>
      <SectionTitle note={BUDGET_HELP.allocationRules}>予算配分ルール</SectionTitle>
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
            <Field label="キーワード（科目名）">
              <Input
                value={r.keywords}
                placeholder="例: 電気、ガス、水道"
                onChangeText={(t) => setField(i, "keywords", t)}
              />
            </Field>
            <Text style={s.members}>
              {r.members.length > 0
                ? `入っている科目: ${r.members.map((a) => displayName(a, viewMode)).join("、")}`
                : r.origKey
                  ? "入っている科目はありません"
                  : "保存すると、キーワードに当たる科目が入ります"}
            </Text>
            <Field label="補足">
              <Input value={r.note} onChangeText={(t) => setField(i, "note", t)} />
            </Field>
          </View>
        ))
      )}
      <Button small variant="link" label="+ ルールを追加" onPress={addRule} />
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
  viewMode,
  onApplied,
}: {
  fiscalYear: number;
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

  // ルールごとの反映の計画（予算が入っている科目は残し、残りを未設定の科目へ按分）
  const plans = new Map(
    (data?.items ?? []).map((item) => [
      item.rule.id,
      planAllocationApply({
        amount: Number(amounts[item.rule.id] ?? item.recommended) || 0,
        accountIds: item.accounts.map((a) => a.id),
        existingBudgets: new Map(
          item.accounts.filter((a) => a.budget !== null).map((a) => [a.id, a.budget!]),
        ),
        weights: new Map(item.accounts.map((a) => [a.id, a.weight])),
      }),
    ]),
  );

  async function apply() {
    if (!data) return;
    const items = [...plans.values()]
      .flatMap((p) => p.added)
      .filter((a) => a.amount > 0)
      .map((a) => ({ accountId: a.accountId, month, amount: a.amount }));
    if (items.length === 0) {
      setMessage(
        "反映する科目がありません（予算が未設定の科目が無いか、入っている予算で推奨額に届いています）",
      );
      return;
    }
    setApplying(true);
    setMessage(null);
    try {
      const result = await applyAllocationToBudget(year, items);
      setMessage(
        `${result.applied} 件の科目に予算を入れました。` +
          (result.skipped > 0
            ? `（その間に予算が入った ${result.skipped} 件はそのままにしました）`
            : ""),
      );
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
          BUDGET_HELP.allocationProposal +
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
            const linked = item.accounts.length > 0;
            const added = new Map(
              (plans.get(item.rule.id)?.added ?? []).map((a) => [a.accountId, a.amount]),
            );
            return (
              <View key={item.rule.id} style={s.item}>
                <View style={{ flex: 1 }}>
                  <Text style={s.itemLabel}>
                    {item.rule.label} <Text style={s.itemGroup}>{item.rule.group}</Text>
                  </Text>
                  {linked ? (
                    item.accounts.map((a) => (
                      <Text key={a.id} style={s.itemMeta}>
                        {displayName(a, viewMode)}{" "}
                        {a.budget !== null
                          ? `予算 ${yen(a.budget)}（そのまま）`
                          : added.has(a.id)
                            ? `→ ${yen(added.get(a.id)!)}`
                            : "—"}
                      </Text>
                    ))
                  ) : (
                    <Text style={s.itemMeta}>—入っている科目なし—</Text>
                  )}
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
          {data.items.some((i) => i.accounts.length === 0) && (
            <Text style={s.hint}>
              科目が入っていない項目は反映できません（web 版の予算配分で科目を移せます）。
            </Text>
          )}

          <Button
            label={applying ? "反映中…" : `${month}月の予算が未設定の科目へ反映`}
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
  viewMode,
  onApplied,
}: {
  fiscalYear: number;
  viewMode: ViewMode;
  /** 予算への反映後に呼ぶ（呼び出し側で予算・履歴・適正額を取り直す） */
  onApplied: () => void;
}) {
  return (
    <>
      <AllocationRulesSection viewMode={viewMode} />
      <AllocationSuggestSection fiscalYear={fiscalYear} viewMode={viewMode} onApplied={onApplied} />
    </>
  );
}

const s = StyleSheet.create({
  members: { fontSize: 11, color: "#64748b", lineHeight: 16, marginBottom: 8 },
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
