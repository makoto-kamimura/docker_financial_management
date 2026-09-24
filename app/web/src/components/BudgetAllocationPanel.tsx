"use client";

// 予算配分（旧「設定 › 予算配分ルール」）。予算管理の「予算配分」タブから使う。
//   1. 予算配分ルール … 収入に対する各項目の割当割合（%）のマスタ。
//      未登録のテナント向けに、ファイナンシャルプランナー推奨の既定ルールを取り込むボタンを置く。
//   2. 配分提案 … 収入額に上の割合を掛けた推奨額。予算へ一括反映できる。
//      既定の「手入力」は入力額をそのまま振り分ける（ローン等の控除なし）。

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { LoadingSpinner } from "@/components/StateViews";

type AccountRef = { id: number; code: string; name: string; category: string };

type AllocationRuleServerRow = {
  id: number;
  key: string;
  label: string;
  group: string;
  minPercent: number;
  maxPercent: number | null;
  note: string | null;
  sortOrder: number;
  account: { id: number; code: string; name: string } | null;
};
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

const ALLOCATION_GROUPS_UI = ["固定費", "生活費", "その他"] as const;

function toEdit(r: AllocationRuleServerRow): RuleEdit {
  return {
    origKey: r.key,
    key: r.key,
    label: r.label,
    group: r.group,
    minPercent: String(r.minPercent),
    maxPercent: r.maxPercent === null ? "" : String(r.maxPercent),
    note: r.note ?? "",
    accountCode: r.account?.code ?? "",
  };
}

// 新規行の key は英数字で一意にする必要があるため、ラベルから起こさずタイムスタンプで採番する
function newRuleKey() {
  return `rule_${Date.now().toString(36)}`;
}

function AllocationRulesSection() {
  const [rules, setRules] = useState<RuleEdit[]>([]);
  const [removedKeys, setRemovedKeys] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<AccountRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/allocation-rules").then((r) => r.json()),
      fetch("/api/accounts").then((r) => r.json()),
    ]).then(([rulesJson, accountsJson]) => {
      setRules((rulesJson.data ?? []).map(toEdit));
      setAccounts(accountsJson.data ?? []);
      setRemovedKeys([]);
      setLoading(false);
    });
  };
  useEffect(() => {
    load();
  }, []);

  const setField = (index: number, field: keyof RuleEdit, value: string) => {
    setRules((rs) => rs.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  };

  const addRule = () => {
    setRules((rs) => [
      ...rs,
      {
        origKey: null,
        key: newRuleKey(),
        label: "",
        group: ALLOCATION_GROUPS_UI[0],
        minPercent: "0",
        maxPercent: "",
        note: "",
        accountCode: "",
      },
    ]);
  };

  const removeRule = (index: number) => {
    setRules((rs) => {
      const target = rs[index];
      if (target.origKey) setRemovedKeys((keys) => [...keys, target.origKey!]);
      return rs.filter((_, i) => i !== index);
    });
  };

  // FP 推奨の既定ルールを取り込む（同じ key が既にある行はサーバー側で維持される）
  const loadDefaults = async () => {
    setSeeding(true);
    setMsg(null);
    const res = await fetch("/api/allocation-rules/defaults", { method: "POST" });
    setSeeding(false);
    if (res.ok) {
      const j = await res.json();
      setRules((j.data ?? []).map(toEdit));
      setRemovedKeys([]);
      setMsg({
        ok: true,
        text:
          (j.created ?? 0) > 0
            ? `推奨ルールを ${j.created} 件追加しました。`
            : "推奨ルールはすべて登録済みです。",
      });
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg({ ok: false, text: err.error ?? "既定ルールの取り込みに失敗しました。" });
    }
  };

  const save = async () => {
    setSaving(true);
    setMsg(null);
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
      setSaving(false);
      setMsg({ ok: false, text: "項目名（ラベル）が未入力の行があります。" });
      return;
    }
    const res = await fetch("/api/allocation-rules", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, removedKeys: removedKeys.length ? removedKeys : undefined }),
    });
    setSaving(false);
    if (res.ok) {
      const j = await res.json();
      setRules((j.data ?? []).map(toEdit));
      setRemovedKeys([]);
      setMsg({ ok: true, text: "予算配分ルールを保存しました。" });
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg({ ok: false, text: err.error ?? "保存に失敗しました。" });
    }
  };

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h2 className="section-title">予算配分ルール</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            収入に対する各項目の割当割合（%）です。初期値はファイナンシャルプランナーが推奨する
            配分（50/30/20 ルールに沿った目安）が入っています。対応科目を紐付けると、下の
            「配分提案」から推奨額をその科目の予算へ一括反映でき、明細一覧の表にも 「適正
            ¥…」として表示されます。
          </p>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={save}
            disabled={saving}
            className="btn-primary px-4 py-2 whitespace-nowrap disabled:opacity-50"
          >
            {saving ? "保存中…" : "変更を保存"}
          </button>
          <button
            onClick={loadDefaults}
            disabled={seeding}
            className="text-xs font-medium text-indigo-600 hover:text-indigo-700 whitespace-nowrap disabled:opacity-50"
          >
            {seeding ? "取り込み中…" : "推奨ルールを取り込む"}
          </button>
        </div>
      </div>

      {msg && (
        <p
          className={`text-xs rounded px-2 py-1.5 mb-3 border ${
            msg.ok
              ? "text-green-700 bg-green-50 border-green-200"
              : "text-red-600 bg-red-50 border-red-200"
          }`}
        >
          {msg.text}
        </p>
      )}

      {loading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-2 pr-3 whitespace-nowrap">グループ</th>
                <th className="text-left py-2 pr-3">ラベル</th>
                <th className="text-left py-2 pr-3 whitespace-nowrap">下限%</th>
                <th className="text-left py-2 pr-3 whitespace-nowrap">上限%</th>
                <th className="text-left py-2 pr-3">対応科目</th>
                <th className="text-left py-2 pr-3">補足</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rules.map((r, i) => (
                <tr key={r.origKey ?? `new-${r.key}`}>
                  <td className="py-1.5 pr-3">
                    <select
                      value={r.group}
                      onChange={(e) => setField(i, "group", e.target.value)}
                      className="input-field w-28"
                    >
                      {ALLOCATION_GROUPS_UI.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      value={r.label}
                      placeholder={r.origKey ? undefined : "例: 貯蓄・投資"}
                      onChange={(e) => setField(i, "label", e.target.value)}
                      className="input-field w-full min-w-[10rem]"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      type="number"
                      value={r.minPercent}
                      onChange={(e) => setField(i, "minPercent", e.target.value)}
                      className="input-field w-20"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      type="number"
                      value={r.maxPercent}
                      placeholder="上限なし"
                      onChange={(e) => setField(i, "maxPercent", e.target.value)}
                      className="input-field w-20"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <select
                      value={r.accountCode}
                      onChange={(e) => setField(i, "accountCode", e.target.value)}
                      className="input-field w-full min-w-[10rem]"
                    >
                      <option value="">— 未紐付け —</option>
                      {accounts.map((a) => (
                        <option key={a.code} value={a.code}>
                          {a.code} {a.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      value={r.note}
                      onChange={(e) => setField(i, "note", e.target.value)}
                      className="input-field w-full min-w-[8rem]"
                    />
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      aria-label="このルールを削除"
                      title="削除"
                      onClick={() => removeRule(i)}
                      className="text-slate-300 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <button
            onClick={addRule}
            className="mt-3 text-xs font-medium text-indigo-600 hover:text-indigo-700"
          >
            + ルールを追加
          </button>
        </div>
      )}
    </div>
  );
}

// ── 配分提案 ─────────────────────────────────────────────────────
type AllocationRuleRef = {
  id: number;
  key: string;
  label: string;
  group: string;
  minPercent: number;
  maxPercent: number | null;
  accountId: number | null;
  sortOrder: number;
};
type AllocationItem = {
  rule: AllocationRuleRef;
  min: number;
  max: number | null;
  recommended: number;
};
type AllocationSuggestion = {
  year: number;
  month: number;
  basis: AllocationBasis;
  basisAmount: number;
  available: number;
  items: AllocationItem[];
  totalRecommended: number;
  overRecommended: boolean;
  summary503020: { needs: number; wants: number; savings: number };
};
type AllocationBasis = "budget" | "actual" | "manual";

const ALLOC_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const allocYen = (v: number) => Math.round(v).toLocaleString("ja-JP");

function AllocationSuggestSection({ fiscalYear }: { fiscalYear: number }) {
  const qc = useQueryClient();
  const now = new Date();
  const [year, setYear] = useState(fiscalYear);
  const [month, setMonth] = useState(now.getMonth() + 1);
  // 既定は「手入力」。予算・実績の入力状況に左右されず、入れた金額をそのまま振り分けられる
  const [basis, setBasis] = useState<AllocationBasis>("manual");
  // 手入力の収入額。「配分を算出」を押したときだけ committedIncome に反映して問い合わせる
  const [incomeInput, setIncomeInput] = useState("");
  const [committedIncome, setCommittedIncome] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<AccountRef[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  const { data, isLoading } = useQuery({
    queryKey: ["allocation-suggest", year, month, basis, committedIncome],
    queryFn: async (): Promise<AllocationSuggestion> => {
      const amountParam = basis === "manual" ? `&amount=${committedIncome ?? 0}` : "";
      const res = await fetch(
        `/api/budgets/allocation-suggest?year=${year}&month=${month}&basis=${basis}${amountParam}`,
      );
      return (await res.json()).data;
    },
    // 手入力は「配分を算出」を押すまで問い合わせない（打鍵のたびに再計算しない）
    enabled: basis !== "manual" || committedIncome !== null,
  });

  useEffect(() => {
    if (!data) return;
    const next: Record<number, string> = {};
    for (const item of data.items) next[item.rule.id] = String(item.recommended);
    setAmounts(next);
  }, [data]);

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
      const res = await fetch("/api/budgets/allocation-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, items }),
      });
      if (res.ok) {
        setMessage(`${items.length} 件の科目に予算を反映しました。`);
        qc.invalidateQueries({ queryKey: ["budgets"] });
        qc.invalidateQueries({ queryKey: ["budget-history"] });
        qc.invalidateQueries({ queryKey: ["allocation-guide"] });
      } else {
        const err = await res.json().catch(() => ({}));
        setMessage(`エラー: ${err.error ?? "反映に失敗しました"}`);
      }
    } finally {
      setApplying(false);
    }
  }

  return (
    <div className="card mt-5">
      <h2 className="section-title mb-1">配分提案</h2>
      <p className="text-xs text-slate-500 mb-4">
        収入額に上のルールの割合を掛けた推奨額です。{year}
        年度の予算へ一括反映できます。反映しなくても、明細一覧の表には「適正
        ¥…」として表示されます。
        {basis === "manual" ? (
          <>
            {" "}
            手入力では、入力した金額だけを純粋に割合で振り分けます（予算・実績やローン返済などは
            考慮しません）。
          </>
        ) : (
          <>
            {" "}
            実績・予算では、その月の収入からローン返済・実物資産の負債分を差し引いた
            「配分可能額」をもとに算出します。
          </>
        )}
      </p>

      <div className="flex flex-wrap items-end gap-4 mb-4">
        <div className="flex flex-col gap-1 w-28">
          <label className="text-xs font-medium text-slate-600">年度</label>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="input-field"
          >
            {Array.from({ length: 5 }, (_, i) => now.getFullYear() - 2 + i).map((y) => (
              <option key={y} value={y}>
                {y}年度
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 w-24">
          <label className="text-xs font-medium text-slate-600">対象月</label>
          <select
            value={month}
            onChange={(e) => setMonth(Number(e.target.value))}
            className="input-field"
          >
            {ALLOC_MONTHS.map((m) => (
              <option key={m} value={m}>
                {m}月
              </option>
            ))}
          </select>
        </div>
        <div className="flex flex-col gap-1 w-36">
          <label className="text-xs font-medium text-slate-600">収入基準額</label>
          <select
            value={basis}
            onChange={(e) => {
              setBasis(e.target.value as AllocationBasis);
              setCommittedIncome(null);
            }}
            className="input-field"
          >
            <option value="manual">手入力</option>
            <option value="actual">実績（収入）</option>
            <option value="budget">予算（収入）</option>
          </select>
        </div>
        {basis === "manual" && (
          <div className="flex items-end gap-2">
            <div className="flex flex-col gap-1 w-40">
              <label className="text-xs font-medium text-slate-600">収入金額（円）</label>
              <input
                type="number"
                min={0}
                value={incomeInput}
                placeholder="例: 450000"
                onChange={(e) => setIncomeInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && incomeInput !== "")
                    setCommittedIncome(Number(incomeInput));
                }}
                className="input-field"
              />
            </div>
            <button
              type="button"
              onClick={() => setCommittedIncome(Number(incomeInput))}
              disabled={incomeInput === ""}
              className="btn-primary px-4 py-2 whitespace-nowrap disabled:opacity-40"
            >
              配分を算出
            </button>
          </div>
        )}
        {data && (
          <div className="text-sm text-slate-600 ml-auto text-right">
            <div>
              収入基準額: <span className="font-semibold">¥{allocYen(data.basisAmount)}</span>
            </div>
            {/* 手入力は控除しないので基準額＝配分額。二重表示を避けて振り分け対象額だけ出す */}
            <div>
              {data.basis === "manual" ? "配分対象額" : "配分可能額（ローン等控除後）"}:{" "}
              <span className="font-semibold text-indigo-700">¥{allocYen(data.available)}</span>
            </div>
          </div>
        )}
      </div>

      {basis === "manual" && committedIncome === null && (
        <p className="text-sm text-slate-400">
          収入金額を入力して「配分を算出」を押すと、その金額をもとに各項目の割当額を計算します。
        </p>
      )}

      {isLoading && <LoadingSpinner />}

      {data && data.overRecommended && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700">
          ⚠ 推奨額の合計（¥{allocYen(data.totalRecommended)}）が
          {data.basis === "manual" ? "配分対象額" : "配分可能額"}（¥{allocYen(data.available)}
          ）を超えています。金額を調整してください。
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-3 gap-3 mb-4">
            {(
              [
                ["固定費", data.summary503020.needs],
                ["生活費", data.summary503020.wants],
                ["その他・貯蓄", data.summary503020.savings],
              ] as [string, number][]
            ).map(([label, value]) => (
              <div key={label} className="rounded-lg bg-slate-50 px-3 py-2 text-center">
                <div className="text-xs text-slate-500">{label}</div>
                <div className="text-sm font-semibold text-slate-700">¥{allocYen(value)}</div>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">項目</th>
                  <th className="px-3 py-2 text-left text-xs font-semibold text-slate-600">
                    対応科目
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">
                    目安（下限〜上限）
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-semibold text-slate-600">
                    反映額
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {data.items.map((item) => {
                  const acct = accounts?.find((a) => a.id === item.rule.accountId);
                  return (
                    <tr key={item.rule.id}>
                      <td className="px-3 py-2">
                        {item.rule.label}
                        <span className="ml-1.5 text-[10px] text-slate-400">{item.rule.group}</span>
                      </td>
                      <td className="px-3 py-2 text-slate-500">
                        {acct ? `${acct.code} ${acct.name}` : "—未紐付け—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-500">
                        ¥{allocYen(item.min)}
                        {item.max !== null ? ` 〜 ¥${allocYen(item.max)}` : " 〜"}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <input
                          type="number"
                          value={amounts[item.rule.id] ?? ""}
                          onChange={(e) =>
                            setAmounts({ ...amounts, [item.rule.id]: e.target.value })
                          }
                          disabled={item.rule.accountId === null}
                          title={
                            item.rule.accountId === null
                              ? "対応科目が未設定のため反映できません（上の表で紐付けてください）"
                              : undefined
                          }
                          className="w-28 text-right border border-slate-300 rounded px-2 py-1 text-xs disabled:bg-slate-50 disabled:text-slate-400"
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button onClick={apply} disabled={applying} className="btn-primary px-5 py-2">
              {applying ? "反映中…" : `${month}月の予算へ一括反映`}
            </button>
            {message && <span className="text-sm text-slate-600">{message}</span>}
          </div>
        </>
      )}
    </div>
  );
}

export function BudgetAllocationPanel({ fiscalYear }: { fiscalYear: number }) {
  return (
    <>
      <AllocationRulesSection />
      <AllocationSuggestSection fiscalYear={fiscalYear} />
    </>
  );
}
