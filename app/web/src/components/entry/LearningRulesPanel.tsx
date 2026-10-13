"use client";

// 実績管理の「設定」タブ。学習ルール（摘要のキーワード → 科目）の一覧と変更。
// 予算管理の「設定」（components/BudgetAllocationPanel.tsx の予算配分ルール）と同じ形にそろえる:
// カードの右上に「変更を保存」、行ごとの入力と削除、表の下に「+ ルールを追加」。保存は一括（PUT）。
// ルールを変えても、すでに付いている明細の科目は変わらない（付け直すのは実績の確定タブの「科目を付け直す」）。
// ルールは事業利用も持てる（指定しない / 事業・按分 / 事業でない）。指定しないルールは、明細の事業利用を変えない。

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { SectionLead, TermDetails } from "@/components/Explain";
import { ENTRY_HELP, LEARNING_RULE_TERMS } from "@/lib/shared/help-texts";
import { displayName, type ViewMode } from "@/lib/shared/display-name";
import type { Account } from "@/components/entry/types";
import { BUSINESS_USE_LABEL, isValidBusinessRatio } from "@/lib/shared/business-use";

type RuleAccount = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName: string | null;
  corporateName: string | null;
};

type RuleServerRow = {
  id: number;
  keyword: string;
  priority: number;
  businessUse: boolean | null;
  businessRatio: number | null;
  updatedAt: string;
  categoryAccount: RuleAccount;
};

/** 画面の事業利用の選択（"" = 指定しない） */
type BusinessChoice = "" | "business" | "private";

type RuleEdit = {
  /** 保存済みのルールの id（null = 新規・保存前） */
  id: number | null;
  /** 新規の行を見分けるための key */
  rowKey: string;
  keyword: string;
  /** 科目の id（"" = 未選択） */
  categoryAccountId: string;
  business: BusinessChoice;
  /** 按分（%）。空なら 100% */
  businessRatio: string;
  updatedAt: string | null;
};

const RULES_QUERY_KEY = ["category-rules"] as const;

/** 選べる科目の区分（明細に付けられる収入・支出の科目） */
const CATEGORY_GROUPS: [string, readonly string[]][] = [
  ["収入", ["REVENUE"]],
  ["支出", ["COGS", "EXPENSE"]],
];

const toEdit = (r: RuleServerRow): RuleEdit => ({
  id: r.id,
  rowKey: `id-${r.id}`,
  keyword: r.keyword,
  categoryAccountId: String(r.categoryAccount.id),
  business: r.businessUse === null ? "" : r.businessUse ? "business" : "private",
  businessRatio: r.businessRatio?.toString() ?? "",
  updatedAt: r.updatedAt,
});

export function LearningRulesPanel({
  mode,
  accounts,
}: {
  mode: ViewMode;
  /** 科目の一覧（実績管理の画面で読み込んだもの） */
  accounts: Account[] | undefined;
}) {
  const qc = useQueryClient();
  const [rules, setRules] = useState<RuleEdit[]>([]);
  const [removedIds, setRemovedIds] = useState<number[]>([]);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: RULES_QUERY_KEY,
    queryFn: async (): Promise<RuleServerRow[]> =>
      (await (await fetch("/api/ledger/category-rules")).json()).data ?? [],
  });

  // サーバーの一覧が来たら、編集中の内容を置き換える（読み込み直後と保存の後）
  useEffect(() => {
    if (!data) return;
    setRules(data.map(toEdit));
    setRemovedIds([]);
  }, [data]);

  const setField = (
    index: number,
    field: "keyword" | "categoryAccountId" | "business" | "businessRatio",
    value: string,
  ) => setRules((rs) => rs.map((r, i) => (i === index ? { ...r, [field]: value } : r)));

  const addRule = () =>
    setRules((rs) => [
      ...rs,
      {
        id: null,
        rowKey: `new-${Date.now().toString(36)}-${rs.length}`,
        keyword: "",
        categoryAccountId: "",
        business: "",
        businessRatio: "",
        updatedAt: null,
      },
    ]);

  const removeRule = (index: number) =>
    setRules((rs) => {
      const target = rs[index];
      if (target.id !== null) setRemovedIds((ids) => [...ids, target.id!]);
      return rs.filter((_, i) => i !== index);
    });

  const save = async () => {
    setMsg(null);
    if (rules.some((r) => r.keyword.trim() === "" || r.categoryAccountId === "")) {
      setMsg({ ok: false, text: "キーワードか科目が未入力の行があります。" });
      return;
    }
    if (
      rules.some(
        (r) =>
          r.business === "business" &&
          r.businessRatio.trim() !== "" &&
          !isValidBusinessRatio(Number(r.businessRatio)),
      )
    ) {
      setMsg({ ok: false, text: "按分は 0 より大きく 100 以下で入れてください。" });
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/ledger/category-rules", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: rules.map((r) => ({
            ...(r.id !== null ? { id: r.id } : {}),
            keyword: r.keyword,
            categoryAccountId: Number(r.categoryAccountId),
            businessUse: r.business === "" ? null : r.business === "business",
            businessRatio:
              r.business === "business" && r.businessRatio.trim() !== ""
                ? Number(r.businessRatio)
                : null,
          })),
          removedIds: removedIds.length ? removedIds : undefined,
        }),
      });
      if (res.ok) {
        qc.setQueryData(RULES_QUERY_KEY, (await res.json()).data ?? []);
        setMsg({ ok: true, text: "学習ルールを保存しました。" });
      } else {
        const err = await res.json().catch(() => ({}));
        setMsg({ ok: false, text: err.error ?? "保存に失敗しました。" });
      }
    } finally {
      setSaving(false);
    }
  };

  const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("ja-JP") : "—");

  return (
    <div className="card">
      <div className="flex items-start justify-between gap-3 mb-2">
        <div>
          <h2 className="section-title">学習ルール</h2>
          <SectionLead className="mt-1">{ENTRY_HELP.learningRules}</SectionLead>
        </div>
        <div className="flex flex-col items-end gap-2 shrink-0">
          <button
            onClick={save}
            disabled={saving || isLoading}
            className="btn-primary whitespace-nowrap"
          >
            {saving ? "保存中…" : "変更を保存"}
          </button>
        </div>
      </div>
      <TermDetails terms={LEARNING_RULE_TERMS} summary="学習ルールのしくみ" className="mb-3" />

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

      {isLoading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : (
        <div className="overflow-x-auto">
          {rules.length === 0 ? (
            <p className="text-sm text-slate-400 py-2">
              学習ルールはまだありません。履歴や実績の確定タブで明細に科目を付けると、ここに増えます。
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="text-left py-2 pr-3">キーワード（摘要）</th>
                  <th className="text-left py-2 pr-3">科目</th>
                  <th className="text-left py-2 pr-3 whitespace-nowrap">
                    {BUSINESS_USE_LABEL}・按分
                  </th>
                  <th className="text-left py-2 pr-3 whitespace-nowrap">更新日</th>
                  <th className="py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {rules.map((r, i) => (
                  <tr key={r.rowKey}>
                    <td className="py-1.5 pr-3">
                      <input
                        value={r.keyword}
                        placeholder={r.id === null ? "例: AMAZON" : undefined}
                        onChange={(e) => setField(i, "keyword", e.target.value)}
                        className="input-field w-full min-w-[14rem]"
                        aria-label="キーワード（摘要）"
                      />
                    </td>
                    <td className="py-1.5 pr-3">
                      <select
                        value={r.categoryAccountId}
                        onChange={(e) => setField(i, "categoryAccountId", e.target.value)}
                        className="input-field w-full min-w-[12rem]"
                        aria-label="科目"
                      >
                        <option value="">科目を選ぶ</option>
                        {CATEGORY_GROUPS.map(([label, categories]) => (
                          <optgroup key={label} label={label}>
                            {(accounts ?? [])
                              .filter((a) => categories.includes(a.category))
                              .map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.code} {displayName(a, mode)}
                                </option>
                              ))}
                          </optgroup>
                        ))}
                      </select>
                    </td>
                    <td className="py-1.5 pr-3">
                      <div className="flex items-center gap-1.5 whitespace-nowrap">
                        <select
                          value={r.business}
                          onChange={(e) => setField(i, "business", e.target.value)}
                          className="input-field"
                          aria-label={BUSINESS_USE_LABEL}
                        >
                          <option value="">指定しない</option>
                          <option value="business">事業</option>
                          <option value="private">事業でない</option>
                        </select>
                        {r.business === "business" && (
                          <>
                            <input
                              type="number"
                              min={0.01}
                              max={100}
                              step={0.01}
                              value={r.businessRatio}
                              placeholder="100"
                              onChange={(e) => setField(i, "businessRatio", e.target.value)}
                              className="input-field w-20 text-right"
                              aria-label="按分（%）"
                            />
                            <span className="text-xs text-slate-500">%</span>
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-1.5 pr-3 text-xs text-slate-500 whitespace-nowrap">
                      {r.id === null ? "未保存" : fmtDate(r.updatedAt)}
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
