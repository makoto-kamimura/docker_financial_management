"use client";

// 予算配分ルール（旧「設定 › 予算配分ルール」）。予算管理の「設定」タブ（右端）から使う。
//   収入に対する各項目の割当割合（%）のマスタ。
//   未登録のテナント向けに、ファイナンシャルプランナー推奨の既定ルールを取り込むボタンを置く。
//   科目は、科目名のキーワードと受け皿の区分で自動で振り分ける（追加した科目も入る）。
//   ルールの下の科目のチップから、別のルールへ移す・配分から外す・自動に戻すができる。
//   この割合で予算を入れる「配分提案」は、はじめての予算の確定のときに「予算の確定」タブに出す
//   （components/AllocationSuggestSection.tsx）。
//   個人事業主モードでは事業の予算の配分ルール（?scope=business）を扱う。家庭のルールとは別に持ち、
//   グループは「生活費」の代わりに「変動費」。

import { Fragment, useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { SectionLead } from "@/components/Explain";
import { BUDGET_HELP } from "@/lib/shared/help-texts";
import { type AssignmentSource } from "@/lib/shared/allocation-assign";
import { useActualsScope } from "@/lib/client/use-view-mode";
import { withScope, type ActualsScope } from "@/lib/shared/business-use";

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

// グループの選択肢（lib/budget/default-allocation-rules.ts の ALLOCATION_GROUPS_BY_SCOPE と同じ）
const ALLOCATION_GROUPS_UI: Record<ActualsScope, readonly string[]> = {
  household: ["固定費", "生活費", "その他"],
  business: ["固定費", "変動費", "その他"],
};
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
  const scope = useActualsScope();
  const groups = ALLOCATION_GROUPS_UI[scope ?? "household"];
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
    if (scope === null) return;
    setLoading(true);
    fetch(withScope("/api/allocation-rules", scope))
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
      const res = await fetch(withScope("/api/allocation-rules/assignments", scope!), {
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
  // モード（範囲）が決まったら読み込む（load は setState だけを使うので、作り直しに追随する必要はない）
  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope]);

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
        group: groups[0],
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
    const res = await fetch(withScope("/api/allocation-rules/defaults", scope!), {
      method: "POST",
    });
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
    const res = await fetch(withScope("/api/allocation-rules", scope!), {
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
          <SectionLead className="mt-1">
            {scope === "business"
              ? BUDGET_HELP.allocationRulesBusiness
              : BUDGET_HELP.allocationRules}
          </SectionLead>
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
                        {groups.map((g) => (
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

export function BudgetAllocationPanel() {
  return <AllocationRulesSection />;
}
