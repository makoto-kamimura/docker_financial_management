"use client";

// 予算配分（旧「設定 › 予算配分ルール」）。予算管理の「設定」タブ（右端）から使う。
//   1. 予算配分ルール … 収入に対する各項目の割当割合（%）のマスタ。
//      未登録のテナント向けに、ファイナンシャルプランナー推奨の既定ルールを取り込むボタンを置く。
//      科目は、科目名のキーワードと受け皿の区分で自動で振り分ける（追加した科目も入る）。
//      ルールの下の科目のチップから、別のルールへ移す・配分から外す・自動に戻すができる。
//   2. 配分提案 … 収入額に上の割合を掛けた推奨額。予算が未設定の科目にだけ反映する
//      （同じルールの科目に入っている予算を差し引いた残りを、前の 3 か月の実績の比率で按分）。
//      既定の「手入力」は入力額をそのまま振り分ける（ローン等の控除なし）。

import { Fragment, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { LoadingSpinner } from "@/components/StateViews";
import { SectionLead } from "@/components/Explain";
import { BUDGET_HELP } from "@/lib/help-texts";
import { useFiscalYear } from "@/lib/use-fiscal-year";
import { planAllocationApply, type AssignmentSource } from "@/lib/allocation-assign";

// 配分ルールのメンバー科目（自動の振り分け＋手動の割り当てを解決したもの）
type MemberAccount = {
  id: number;
  code: string;
  name: string;
  category: string;
  source: AssignmentSource;
};

type AllocationRuleServerRow = {
  id: number;
  key: string;
  label: string;
  group: string;
  minPercent: number;
  maxPercent: number | null;
  note: string | null;
  keywords: string[];
  fallbackCategory: string | null;
  sortOrder: number;
  accounts: MemberAccount[];
};
type RulesResponse = { data?: AllocationRuleServerRow[]; unassigned?: MemberAccount[] };
type RuleEdit = {
  origKey: string | null; // null = 新規（保存前）
  key: string;
  label: string;
  group: string;
  minPercent: string;
  maxPercent: string; // 空 = 上限なし
  note: string;
  keywords: string; // 読点・カンマ区切り
  fallbackCategory: string; // 空 = 受け皿ではない
};

const ALLOCATION_GROUPS_UI = ["固定費", "生活費", "その他"] as const;
const FALLBACK_OPTIONS = [
  ["", "—"],
  ["EXPENSE", "固定費の残り"],
  ["COGS", "変動費の残り"],
  ["PROFIT", "貯蓄の残り"],
] as const;

const parseKeywords = (text: string) => [
  ...new Set(
    text
      .split(/[、,，\s]+/)
      .map((k) => k.trim())
      .filter(Boolean),
  ),
];

function toEdit(r: AllocationRuleServerRow): RuleEdit {
  return {
    origKey: r.key,
    key: r.key,
    label: r.label,
    group: r.group,
    minPercent: String(r.minPercent),
    maxPercent: r.maxPercent === null ? "" : String(r.maxPercent),
    note: r.note ?? "",
    keywords: r.keywords.join("、"),
    fallbackCategory: r.fallbackCategory ?? "",
  };
}

// 科目のチップ。押すと移し先を選べる（別のルール・配分に入れない・自動に戻す）
function AccountChip({
  account,
  rules,
  currentRuleId,
  busy,
  onMove,
}: {
  account: MemberAccount;
  rules: { id: number; label: string }[];
  currentRuleId: number | null;
  busy: boolean;
  onMove: (accountId: number, ruleId: number | null | "auto") => void;
}) {
  const manual = account.source === "manual";
  return (
    <label
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
        manual
          ? "border-indigo-300 bg-indigo-50 text-indigo-800"
          : "border-slate-200 bg-white text-slate-600"
      }`}
      title={
        manual
          ? "手で割り当てた科目です"
          : account.source === "keyword"
            ? "科目名のキーワードで自動で入っています"
            : account.source === "fallback"
              ? "区分の受け皿として自動で入っています"
              : "どのルールにも当たっていません"
      }
    >
      <span className="font-mono text-slate-400">{account.code}</span>
      {account.name}
      <select
        aria-label={`${account.name}の移し先`}
        value=""
        disabled={busy}
        onChange={(e) => {
          const v = e.target.value;
          if (!v) return;
          onMove(account.id, v === "auto" ? "auto" : v === "none" ? null : Number(v));
        }}
        className="ml-0.5 w-4 bg-transparent text-slate-400 cursor-pointer focus:outline-none"
      >
        <option value="">移す…</option>
        {manual && <option value="auto">自動に戻す</option>}
        {currentRuleId !== null && <option value="none">配分に入れない</option>}
        {rules
          .filter((r) => r.id !== currentRuleId)
          .map((r) => (
            <option key={r.id} value={r.id}>
              {r.label} へ
            </option>
          ))}
      </select>
    </label>
  );
}

// 新規行の key は英数字で一意にする必要があるため、ラベルから起こさずタイムスタンプで採番する
function newRuleKey() {
  return `rule_${Date.now().toString(36)}`;
}

function AllocationRulesSection() {
  const [rules, setRules] = useState<RuleEdit[]>([]);
  const [removedKeys, setRemovedKeys] = useState<string[]>([]);
  // 保存済みのルールごとのメンバー科目（ルールの編集とは別に持ち、移しても編集中の内容は消さない）
  const [members, setMembers] = useState<Map<string, MemberAccount[]>>(new Map());
  const [ruleIds, setRuleIds] = useState<Map<string, number>>(new Map());
  const [unassigned, setUnassigned] = useState<MemberAccount[]>([]);
  const [moving, setMoving] = useState(false);
  const qc = useQueryClient();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  // サーバーの一覧から、メンバー科目と未分類を反映する（withEdits: ルールの編集内容も置き換える）
  const applyView = (j: RulesResponse, withEdits: boolean) => {
    const rows = j.data ?? [];
    if (withEdits) {
      setRules(rows.map(toEdit));
      setRemovedKeys([]);
    }
    setMembers(new Map(rows.map((r) => [r.key, r.accounts])));
    setRuleIds(new Map(rows.map((r) => [r.key, r.id])));
    setUnassigned(j.unassigned ?? []);
  };

  const load = () => {
    setLoading(true);
    fetch("/api/allocation-rules")
      .then((r) => r.json())
      .then((j: RulesResponse) => {
        applyView(j, true);
        setLoading(false);
      });
  };

  // 科目を別のルールへ移す・配分から外す・自動に戻す（すぐ保存する）
  const moveAccount = async (accountId: number, ruleId: number | null | "auto") => {
    setMoving(true);
    setMsg(null);
    try {
      const res = await fetch("/api/allocation-rules/assignments", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, ruleId }),
      });
      if (res.ok) {
        applyView(await res.json(), false);
        qc.invalidateQueries({ queryKey: ["allocation-suggest"] });
        qc.invalidateQueries({ queryKey: ["allocation-guide"] });
      } else {
        const err = await res.json().catch(() => ({}));
        setMsg({ ok: false, text: err.error ?? "科目を移せませんでした。" });
      }
    } finally {
      setMoving(false);
    }
  };
  // 初回だけ読み込む（load は setState だけを使うので、作り直しに追随する必要はない）
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
        keywords: "",
        fallbackCategory: "",
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
      applyView(j, true);
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
      keywords: parseKeywords(r.keywords),
      fallbackCategory: r.fallbackCategory === "" ? null : r.fallbackCategory,
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
      applyView(await res.json(), true);
      qc.invalidateQueries({ queryKey: ["allocation-suggest"] });
      qc.invalidateQueries({ queryKey: ["allocation-guide"] });
      setMsg({ ok: true, text: "予算配分ルールを保存しました。" });
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg({ ok: false, text: err.error ?? "保存に失敗しました。" });
    }
  };

  // 移し先の候補（保存済みのルールだけ）
  const chipTargets = rules
    .filter((r) => r.origKey && ruleIds.has(r.origKey))
    .map((r) => ({ id: ruleIds.get(r.origKey!)!, label: r.label }));

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h2 className="section-title">予算配分ルール</h2>
          <SectionLead className="mt-1">{BUDGET_HELP.allocationRules}</SectionLead>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button onClick={save} disabled={saving} className="btn-primary whitespace-nowrap">
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
                <th className="text-left py-2 pr-3">キーワード（科目名）</th>
                <th className="text-left py-2 pr-3 whitespace-nowrap">受け皿</th>
                <th className="text-left py-2 pr-3">補足</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rules.map((r, i) => (
                <Fragment key={r.origKey ?? `new-${r.key}`}>
                  <tr>
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
                      <input
                        value={r.keywords}
                        placeholder="例: 電気、ガス、水道"
                        onChange={(e) => setField(i, "keywords", e.target.value)}
                        className="input-field w-full min-w-[12rem]"
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <select
                        value={r.fallbackCategory}
                        onChange={(e) => setField(i, "fallbackCategory", e.target.value)}
                        className="input-field w-32"
                        title="キーワードに当たらなかったこの区分の科目を、このルールで受け取ります"
                      >
                        {FALLBACK_OPTIONS.map(([v, l]) => (
                          <option key={v} value={v}>
                            {l}
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
                  {/* このルールに入っている科目（保存済みの内容で振り分けたもの） */}
                  <tr>
                    <td />
                    <td colSpan={7} className="pb-2 pr-3">
                      <div className="flex flex-wrap gap-1">
                        {(members.get(r.key) ?? []).map((a) => (
                          <AccountChip
                            key={a.id}
                            account={a}
                            rules={chipTargets}
                            currentRuleId={ruleIds.get(r.key) ?? null}
                            busy={moving}
                            onMove={moveAccount}
                          />
                        ))}
                        {r.origKey && (members.get(r.key) ?? []).length === 0 && (
                          <span className="text-[11px] text-slate-400">
                            入っている科目はありません
                          </span>
                        )}
                        {!r.origKey && (
                          <span className="text-[11px] text-slate-400">
                            保存すると、キーワードに当たる科目が入ります
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                </Fragment>
              ))}
            </tbody>
          </table>
          {unassigned.length > 0 && (
            <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
              <p className="text-xs font-medium text-amber-800 mb-1.5">
                どのルールにも入っていない科目（配分の対象外）
              </p>
              <div className="flex flex-wrap gap-1">
                {unassigned.map((a) => (
                  <AccountChip
                    key={a.id}
                    account={a}
                    rules={chipTargets}
                    currentRuleId={null}
                    busy={moving}
                    onMove={moveAccount}
                  />
                ))}
              </div>
            </div>
          )}
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
  sortOrder: number;
};
type SuggestAccount = MemberAccount & {
  /** 按分の重み（前の 3 か月の実績） */
  weight: number;
  /** 推奨額をこの科目に按分した額 */
  recommended: number;
  /** その月にすでに入っている予算（null = 未設定） */
  budget: number | null;
};
type AllocationItem = {
  rule: AllocationRuleRef;
  min: number;
  max: number | null;
  recommended: number;
  accounts: SuggestAccount[];
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

function AllocationSuggestSection() {
  const qc = useQueryClient();
  const now = new Date();
  // 対象年度は左のメニューで選ぶ（全画面で共通）
  const year = useFiscalYear();
  const [month, setMonth] = useState(now.getMonth() + 1);
  // 既定は「手入力」。予算・実績の入力状況に左右されず、入れた金額をそのまま振り分けられる
  const [basis, setBasis] = useState<AllocationBasis>("manual");
  // 手入力の収入額。「配分を算出」を押したときだけ committedIncome に反映して問い合わせる
  const [incomeInput, setIncomeInput] = useState("");
  const [committedIncome, setCommittedIncome] = useState<number | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

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
      const res = await fetch("/api/budgets/allocation-apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ year, items, onlyUnset: true }),
      });
      if (res.ok) {
        const { data: result } = await res.json();
        setMessage(
          `${result.applied} 件の科目に予算を入れました。` +
            (result.skipped > 0
              ? `（その間に予算が入った ${result.skipped} 件はそのままにしました）`
              : ""),
        );
        qc.invalidateQueries({ queryKey: ["allocation-suggest"] });
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
      <SectionLead className="mb-4">
        {BUDGET_HELP.allocationProposal}
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
      </SectionLead>

      <div className="flex flex-wrap items-end gap-4 mb-4">
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
              className="btn-primary whitespace-nowrap"
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
                    科目（入っている予算 → 新しく入れる額）
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
                  const plan = plans.get(item.rule.id);
                  const addedById = new Map(
                    (plan?.added ?? []).map((a) => [a.accountId, a.amount]),
                  );
                  const noAccounts = item.accounts.length === 0;
                  return (
                    <tr key={item.rule.id}>
                      <td className="px-3 py-2">
                        {item.rule.label}
                        <span className="ml-1.5 text-[10px] text-slate-400">{item.rule.group}</span>
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-500">
                        {noAccounts ? (
                          "—入っている科目なし—"
                        ) : (
                          <ul className="space-y-0.5">
                            {item.accounts.map((a) => (
                              <li key={a.id} className="flex justify-between gap-3">
                                <span>{a.name}</span>
                                <span className="tabular-nums">
                                  {a.budget !== null ? (
                                    <span className="text-slate-400">
                                      予算 ¥{allocYen(a.budget)}（そのまま）
                                    </span>
                                  ) : addedById.has(a.id) ? (
                                    <span className="text-indigo-700">
                                      → ¥{allocYen(addedById.get(a.id)!)}
                                    </span>
                                  ) : (
                                    <span className="text-slate-300">—</span>
                                  )}
                                </span>
                              </li>
                            ))}
                          </ul>
                        )}
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
                          disabled={noAccounts}
                          title={
                            noAccounts
                              ? "入っている科目が無いため反映できません（上の表で科目を移してください）"
                              : "このルール全体の金額。入っている予算を差し引いた残りを、予算が未設定の科目へ按分します"
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
            <button onClick={apply} disabled={applying} className="btn-primary">
              {applying ? "反映中…" : `${month}月の予算が未設定の科目へ反映`}
            </button>
            {message && <span className="text-sm text-slate-600">{message}</span>}
          </div>
        </>
      )}
    </div>
  );
}

export function BudgetAllocationPanel() {
  return (
    <>
      <AllocationRulesSection />
      <AllocationSuggestSection />
    </>
  );
}
