// 予算配分ルール（web 版 components/BudgetAllocationPanel.tsx と同じ構成）。予算画面の「設定」タブ（右端）から使う。
//   収入に対する各項目の割当割合（%）のマスタ。FP 推奨の既定ルールを取り込める。
//   科目は科目名のキーワードと受け皿の区分で自動で振り分ける（ここでは表示のみ。移すのは web 版）。
//   この割合で予算を入れる「配分提案」は、はじめての予算の確定のときに「予算の確定」に出す
//   （components/AllocationSuggestSection.tsx）。
import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  ALLOCATION_GROUPS,
  fetchAllocationRules,
  importDefaultAllocationRules,
  saveAllocationRules,
  type AllocationRule,
  type ViewMode,
} from "../api";
import { displayName } from "../shared/display-name";
import { Button, Card, EmptyText, Field, Input, Notice, Pills, SectionTitle } from "./ui";
import { BUDGET_HELP } from "../shared/help-texts";

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

export function BudgetAllocationPanel({ viewMode }: { viewMode: ViewMode }) {
  return <AllocationRulesSection viewMode={viewMode} />;
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
});
