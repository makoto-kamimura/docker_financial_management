// 配分提案（web 版 components/AllocationSuggestSection.tsx と同じ）。収入額に予算配分ルールの割合を掛けた
// 推奨額（計算はサーバー側）。予算が未設定の科目にだけ、入っている予算を差し引いた残りを
// 前の 3 か月の実績の比率で按分して反映する。既定の「手入力」は入力額をそのまま振り分ける（ローン等の控除なし）。
// はじめての予算の確定（前月も当月も実績が無い）のときに、「予算の確定」（BudgetConfirmSection）で
// 予算の月に固定して使う。
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import {
  applyAllocationToBudget,
  fetchAllocationSuggestion,
  type AllocationBasis,
  type AllocationSuggestion,
  type ViewMode,
} from "../api";
import { displayName } from "../shared/display-name";
import { digitsOnly, yen } from "../format";
import { Button, Card, EmptyText, Field, Input, Notice, Pills, SectionTitle } from "./ui";
import { BUDGET_HELP } from "../shared/help-texts";
import { planAllocationApply } from "../shared/allocation-assign";

const BASIS_OPTIONS: { value: AllocationBasis; label: string }[] = [
  { value: "manual", label: "手入力" },
  { value: "actual", label: "実績（収入）" },
  { value: "budget", label: "予算（収入）" },
];

export function AllocationSuggestSection({
  year,
  month,
  viewMode,
  onApplied,
}: {
  /** 予算の月（予算の確定で選んでいる月に固定する） */
  year: number;
  month: number;
  viewMode: ViewMode;
  /** 予算への反映後に呼ぶ（呼び出し側で予算の確定の状況や予算を取り直す） */
  onApplied: () => void;
}) {
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

  const availableLabel =
    data?.basis === "manual" ? "配分対象額" : "配分可能額（目安の外のローン等を控除後）";

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
        {month}月の配分提案
      </SectionTitle>

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
                          ? `予算 ${yen(a.budget)}${a.overlay > 0 ? `（返済の自動反映 ${yen(a.overlay)} を含む）` : "（そのまま）"}`
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

const s = StyleSheet.create({
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
