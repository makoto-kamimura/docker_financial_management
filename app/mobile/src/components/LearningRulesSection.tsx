// 実績の画面の「設定」タブ。学習ルール（摘要のキーワード → 科目）の一覧と変更
// （web 版 components/entry/LearningRulesPanel.tsx と同じ）。予算の「設定」の予算配分ルール
// （BudgetAllocationPanel.tsx）と同じ形にそろえる: 「変更を保存」、行ごとの入力と削除、「+ ルールを追加」。
// ルールを変えても、すでに付いている明細の科目は変わらない（付け直すのは実績の確定の「科目を付け直す」）。
import { useEffect, useState } from "react";
import { StyleSheet, Text, TouchableOpacity, View } from "react-native";
import {
  fetchAccounts,
  fetchCategoryRules,
  saveCategoryRules,
  type Account,
  type CategoryRule,
  type ViewMode,
} from "../api";
import { displayName } from "../shared/display-name";
import { ENTRY_HELP, LEARNING_RULE_TERMS } from "../shared/help-texts";
import { AccountPickerModal } from "./CategoryPickerModal";
import { Button, Card, EmptyText, Field, Input, Notice, SectionTitle, TermList } from "./ui";

/** 選べる科目の区分（明細に付けられる収入・支出の科目） */
const RULE_CATEGORIES = ["REVENUE", "COGS", "EXPENSE"] as const;

type RuleEdit = {
  /** 保存済みのルールの id（null = 新規・保存前） */
  id: number | null;
  rowKey: string;
  keyword: string;
  categoryAccountId: number | null;
  updatedAt: string | null;
};

const toEdit = (r: CategoryRule): RuleEdit => ({
  id: r.id,
  rowKey: `id-${r.id}`,
  keyword: r.keyword,
  categoryAccountId: r.categoryAccount.id,
  updatedAt: r.updatedAt,
});

type Message = { ok: boolean; text: string } | null;

export function LearningRulesSection({
  viewMode,
  refreshKey = 0,
}: {
  viewMode: ViewMode;
  /** 値が変わると読み直す（引っ張って更新） */
  refreshKey?: number;
}) {
  const [rules, setRules] = useState<RuleEdit[]>([]);
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<Message>(null);
  // 科目を選んでいる行（rowKey）
  const [picking, setPicking] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchCategoryRules(), fetchAccounts()])
      .then(([rs, as]) => {
        setRules(rs.map(toEdit));
        setRemovedIds([]);
        setAccounts(as);
      })
      .catch((e) => setMsg({ ok: false, text: e instanceof Error ? e.message : String(e) }))
      .finally(() => setLoading(false));
  }, [refreshKey]);

  const accountById = new Map(accounts.map((a) => [a.id, a]));
  const update = (rowKey: string, patch: Partial<RuleEdit>) =>
    setRules((rs) => rs.map((r) => (r.rowKey === rowKey ? { ...r, ...patch } : r)));

  const addRule = () =>
    setRules((rs) => [
      ...rs,
      {
        id: null,
        rowKey: `new-${Date.now().toString(36)}-${rs.length}`,
        keyword: "",
        categoryAccountId: null,
        updatedAt: null,
      },
    ]);

  const removeRule = (rowKey: string) =>
    setRules((rs) => {
      const target = rs.find((r) => r.rowKey === rowKey);
      if (target?.id != null) setRemovedIds((ids) => [...ids, target.id!]);
      return rs.filter((r) => r.rowKey !== rowKey);
    });

  async function save() {
    if (rules.some((r) => r.keyword.trim() === "" || r.categoryAccountId === null)) {
      setMsg({ ok: false, text: "キーワードか科目が未入力の行があります。" });
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const saved = await saveCategoryRules(
        rules.map((r) => ({
          ...(r.id !== null ? { id: r.id } : {}),
          keyword: r.keyword,
          categoryAccountId: r.categoryAccountId!,
        })),
        removedIds,
      );
      setRules(saved.map(toEdit));
      setRemovedIds([]);
      setMsg({ ok: true, text: "学習ルールを保存しました。" });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : "保存に失敗しました。" });
    } finally {
      setSaving(false);
    }
  }

  const pickingRule = rules.find((r) => r.rowKey === picking) ?? null;

  return (
    <Card>
      <SectionTitle note={ENTRY_HELP.learningRules}>学習ルール</SectionTitle>
      <TermList terms={LEARNING_RULE_TERMS} label="学習ルールのしくみ" />
      <View style={s.actions}>
        <Button small label="変更を保存" onPress={save} loading={saving} disabled={loading} />
      </View>
      {msg && <Notice tone={msg.ok ? "success" : "error"}>{msg.text}</Notice>}

      {loading ? (
        <EmptyText>読み込み中…</EmptyText>
      ) : rules.length === 0 ? (
        <EmptyText>
          学習ルールはまだありません。履歴や実績の確定で明細に科目を付けると、ここに増えます。
        </EmptyText>
      ) : (
        rules.map((r) => {
          const account =
            r.categoryAccountId !== null ? accountById.get(r.categoryAccountId) : null;
          return (
            <View key={r.rowKey} style={s.rule}>
              <View style={s.ruleHead}>
                <Text style={s.updated}>
                  {r.id === null
                    ? "未保存"
                    : `更新 ${r.updatedAt ? new Date(r.updatedAt).toLocaleDateString("ja-JP") : "—"}`}
                </Text>
                <TouchableOpacity onPress={() => removeRule(r.rowKey)} hitSlop={8}>
                  <Text style={s.remove}>削除</Text>
                </TouchableOpacity>
              </View>
              <Field label="キーワード（摘要）">
                <Input
                  value={r.keyword}
                  placeholder={r.id === null ? "例: AMAZON" : undefined}
                  autoCapitalize="characters"
                  onChangeText={(t) => update(r.rowKey, { keyword: t })}
                />
              </Field>
              <Field label="科目">
                <TouchableOpacity style={s.picker} onPress={() => setPicking(r.rowKey)}>
                  <Text style={account ? s.pickerText : s.pickerPlaceholder} numberOfLines={1}>
                    {account ? `${account.code} ${displayName(account, viewMode)}` : "科目を選ぶ"}
                  </Text>
                </TouchableOpacity>
              </Field>
            </View>
          );
        })
      )}
      <Button small variant="link" label="+ ルールを追加" onPress={addRule} />

      <AccountPickerModal
        visible={pickingRule !== null}
        accounts={accounts}
        categories={RULE_CATEGORIES}
        title="ルールの科目"
        description={pickingRule?.keyword || undefined}
        currentId={pickingRule?.categoryAccountId ?? null}
        onSelect={(a) => {
          if (pickingRule && a) update(pickingRule.rowKey, { categoryAccountId: a.id });
          setPicking(null);
        }}
        onClose={() => setPicking(null)}
      />
    </Card>
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
  updated: { fontSize: 11, color: "#94a3b8" },
  remove: { fontSize: 12, color: "#dc2626", fontWeight: "600" },
  picker: {
    borderWidth: 1,
    borderColor: "#cbd5e1",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    backgroundColor: "#ffffff",
  },
  pickerText: { fontSize: 14, color: "#1e293b" },
  pickerPlaceholder: { fontSize: 14, color: "#94a3b8" },
});
