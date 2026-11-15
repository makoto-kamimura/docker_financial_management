"use client";

// 実績管理の「設定」タブの、明細分け（通販の注文）の商品名の学習ルール（商品名のキーワード → 科目）。
// 商品の科目を付けたときに覚え、注文の取り込みで当てる。長い商品名で覚えたキーワードは、短く直すと似た商品にも当たる。
// 行ごとに保存する（摘要のルールのような一括保存はしない）。ルールを変えても、付いている商品の科目は変わらない。
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { SectionLead } from "@/components/Explain";
import { Notice } from "@/components/ui";
import { displayName, type ViewMode } from "@/lib/shared/display-name";
import { SHOP_HELP } from "@/lib/shared/help-texts";
import type { Account } from "@/components/entry/types";

type ShopRule = {
  id: number;
  keyword: string;
  categoryAccount: {
    id: number;
    code: string;
    name: string;
    soleName: string | null;
    corporateName: string | null;
  };
};

export function ShopItemRulesPanel({
  mode,
  accounts,
}: {
  mode: ViewMode;
  accounts: Account[] | undefined;
}) {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const { data: rules } = useQuery({
    queryKey: ["shop-item-rules"],
    queryFn: async (): Promise<ShopRule[]> =>
      (await (await fetch("/api/shop-item-rules")).json()).data ?? [],
  });
  const categorizable = (accounts ?? []).filter((a) =>
    ["REVENUE", "COGS", "EXPENSE"].includes(a.category),
  );

  async function save(id: number, change: { keyword?: string; categoryAccountId?: number }) {
    setError(null);
    const res = await fetch(`/api/shop-item-rules/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change),
    });
    if (!res.ok) {
      const j = await res.json().catch(() => null);
      setError(j?.error ?? "保存に失敗しました");
    }
    qc.invalidateQueries({ queryKey: ["shop-item-rules"] });
  }

  async function remove(r: ShopRule) {
    if (!confirm(`「${r.keyword}」のルールを削除してよいですか？`)) return;
    const res = await fetch(`/api/shop-item-rules/${r.id}`, { method: "DELETE" });
    if (!res.ok) setError("削除に失敗しました");
    qc.invalidateQueries({ queryKey: ["shop-item-rules"] });
  }

  return (
    <div className="card mt-6">
      <h2 className="section-title mb-1">明細分けの商品名のルール</h2>
      <SectionLead className="mb-3">{SHOP_HELP.itemRules}</SectionLead>
      {error && (
        <Notice tone="error" onClose={() => setError(null)} className="mb-3">
          {error}
        </Notice>
      )}
      {!rules ? (
        <p className="text-sm text-slate-400">読み込み中…</p>
      ) : rules.length === 0 ? (
        <p className="text-sm text-slate-500">
          まだありません。実績管理の履歴（出どころ:
          明細分け）で商品に科目を付けると、ここに増えます。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                <th className="px-3 py-2 text-left font-semibold">商品名のキーワード</th>
                <th className="px-3 py-2 text-left font-semibold">科目</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rules.map((r) => (
                <RuleRow
                  key={r.id}
                  rule={r}
                  mode={mode}
                  categorizable={categorizable}
                  onSave={(change) => save(r.id, change)}
                  onRemove={() => remove(r)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function RuleRow({
  rule,
  mode,
  categorizable,
  onSave,
  onRemove,
}: {
  rule: ShopRule;
  mode: ViewMode;
  categorizable: Account[];
  onSave: (change: { keyword?: string; categoryAccountId?: number }) => void;
  onRemove: () => void;
}) {
  const [keyword, setKeyword] = useState(rule.keyword);
  useEffect(() => setKeyword(rule.keyword), [rule.keyword]);
  const saveKeyword = () => {
    const next = keyword.trim();
    if (next && next !== rule.keyword) onSave({ keyword: next });
    else setKeyword(rule.keyword);
  };
  return (
    <tr>
      <td className="px-3 py-1.5">
        <input
          value={keyword}
          onChange={(ev) => setKeyword(ev.target.value)}
          onBlur={saveKeyword}
          onKeyDown={(ev) => ev.key === "Enter" && saveKeyword()}
          aria-label="商品名のキーワード"
          className="w-full min-w-60 border border-slate-200 rounded px-2 py-1 text-sm"
        />
      </td>
      <td className="px-3 py-1.5">
        <select
          value={rule.categoryAccount.id}
          onChange={(ev) => onSave({ categoryAccountId: Number(ev.target.value) })}
          aria-label={`${rule.keyword} の科目`}
          className="text-xs border border-slate-200 rounded px-1.5 py-1 bg-white min-w-40"
        >
          {categorizable.map((a) => (
            <option key={a.id} value={a.id}>
              {a.code} {displayName(a, mode)}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-1.5 text-right">
        <button
          type="button"
          onClick={onRemove}
          className="text-slate-300 hover:text-red-500"
          aria-label="ルールを削除"
        >
          <Trash2 className="w-4 h-4" />
        </button>
      </td>
    </tr>
  );
}
