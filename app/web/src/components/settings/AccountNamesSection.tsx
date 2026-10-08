"use client";

// 設定の「科目名設定」タブ（モード別の表示名の管理）。

import { useEffect, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { SETTINGS_HELP } from "@/lib/help-texts";
// 区分名は予算管理・実績管理と同じ（lib/labels.ts）
import { CATEGORY_LABEL } from "@/lib/labels";
import { SaveNotice, SectionCard, type SaveMessage } from "@/components/SectionCard";

// ── 科目名設定セクション（モード別表示名の管理）──────────────────
type AccountNameRow = {
  id: number;
  code: string;
  name: string;
  soleName: string | null;
  corporateName: string | null;
  category: string;
};

export function AccountNamesSection() {
  const [rows, setRows] = useState<AccountNameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<SaveMessage>(null);
  // 変更中の行（家庭科目名・区分・モード別表示名）
  type NameEdit = {
    code: string;
    name: string;
    category: string;
    soleName: string;
    corporateName: string;
  };
  const [dirty, setDirty] = useState<Record<number, NameEdit>>({});
  // 科目が入っている予算配分ルール（科目名のキーワードと区分で自動で振り分け。予算管理 › 予算配分で変える）
  const [ruleByAccount, setRuleByAccount] = useState<Map<number, string>>(new Map());

  const load = () => {
    setLoading(true);
    Promise.all([
      fetch("/api/accounts").then((r) => r.json()),
      fetch("/api/allocation-rules")
        .then((r) => r.json())
        .catch(() => ({})),
    ]).then(([j, rulesJson]) => {
      setRows(j.data ?? []);
      setDirty({});
      const map = new Map<number, string>();
      for (const rule of rulesJson.data ?? []) {
        for (const a of rule.accounts ?? []) map.set(a.id, rule.label);
      }
      setRuleByAccount(map);
      setLoading(false);
    });
  };
  useEffect(() => {
    load();
  }, []);

  const setField = (id: number, key: keyof NameEdit, value: string) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
    setDirty((d) => {
      const row = rows.find((r) => r.id === id)!;
      const base = d[id] ?? {
        code: row.code,
        name: row.name,
        category: row.category,
        soleName: row.soleName ?? "",
        corporateName: row.corporateName ?? "",
      };
      return { ...d, [id]: { ...base, [key]: value } };
    });
  };

  const save = async () => {
    const items = Object.entries(dirty).map(([id, v]) => ({
      id: Number(id),
      code: v.code.trim(),
      name: v.name.trim(),
      category: v.category,
      soleName: v.soleName,
      corporateName: v.corporateName,
    }));
    if (items.length === 0) {
      setMsg({ ok: false, text: "変更がありません。" });
      return;
    }
    if (items.some((i) => i.name === "" || i.code === "")) {
      setMsg({ ok: false, text: "コードまたは家庭科目名が空の行があります。" });
      return;
    }
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/accounts/display-names", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    });
    setSaving(false);
    if (res.ok) {
      const j = await res.json();
      setRows(j.data ?? []);
      setDirty({});
      setMsg({ ok: true, text: `${items.length} 件の科目を保存しました。` });
    } else {
      setMsg({ ok: false, text: "保存に失敗しました。" });
    }
  };

  const dirtyCount = Object.keys(dirty).length;

  const deleteAccount = async (row: AccountNameRow) => {
    if (!confirm(`「${row.code} ${row.name}」を削除してよいですか？`)) return;
    const res = await fetch(`/api/accounts/${row.id}`, { method: "DELETE" });
    if (res.ok) {
      load();
      setMsg({ ok: true, text: `科目「${row.code} ${row.name}」を削除しました。` });
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg({ ok: false, text: err.error ?? "科目の削除に失敗しました。" });
    }
  };

  // 新規科目の追加（コードは同じ区分の既存コードから自動採番される）
  const [newCategory, setNewCategory] = useState("EXPENSE");
  const [newName, setNewName] = useState("");
  const [adding, setAdding] = useState(false);

  const addAccount = async () => {
    const name = newName.trim();
    if (name === "") {
      setMsg({ ok: false, text: "追加する科目名を入力してください。" });
      return;
    }
    setAdding(true);
    setMsg(null);
    const res = await fetch("/api/accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, category: newCategory }),
    });
    setAdding(false);
    if (res.ok) {
      const j = await res.json();
      setNewName("");
      load();
      setMsg({ ok: true, text: `科目「${j.data.code} ${j.data.name}」を追加しました。` });
    } else {
      const err = await res.json().catch(() => ({}));
      setMsg({ ok: false, text: err.error ?? "科目の追加に失敗しました。" });
    }
  };

  return (
    <SectionCard
      title="科目名設定"
      lead={SETTINGS_HELP.accountNames}
      actions={
        <button
          onClick={save}
          disabled={saving || dirtyCount === 0}
          className="btn-primary whitespace-nowrap"
        >
          {saving ? "保存中…" : dirtyCount > 0 ? `変更を保存 (${dirtyCount})` : "変更を保存"}
        </button>
      }
    >
      {/* 表が長いので、保存の結果は表の上（保存ボタンの近く）に出す */}
      <SaveNotice msg={msg} className="mb-3" />

      {loading ? (
        <p className="text-slate-400 text-sm">読み込み中…</p>
      ) : rows.length === 0 ? (
        <p className="text-slate-400 text-sm">
          勘定科目が登録されていません。マスタ管理から登録してください。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="text-left py-2 pr-3 whitespace-nowrap">コード</th>
                <th className="text-left py-2 pr-3 whitespace-nowrap">家庭科目名</th>
                <th className="text-left py-2 pr-3 whitespace-nowrap">区分</th>
                <th className="text-left py-2 pr-3">個人事業主モード表示名</th>
                <th className="text-left py-2 pr-3">法人モード表示名</th>
                <th className="text-left py-2 pr-3 whitespace-nowrap">予算配分</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3">
                    <input
                      value={r.code}
                      onChange={(e) => setField(r.id, "code", e.target.value)}
                      className="input-field w-24 font-mono"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      value={r.name}
                      onChange={(e) => setField(r.id, "name", e.target.value)}
                      className="input-field w-full min-w-[10rem]"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <select
                      value={r.category}
                      onChange={(e) => setField(r.id, "category", e.target.value)}
                      className="input-field w-32"
                    >
                      {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      value={r.soleName ?? ""}
                      placeholder={r.name}
                      onChange={(e) => setField(r.id, "soleName", e.target.value)}
                      className="input-field w-full min-w-[12rem]"
                    />
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      value={r.corporateName ?? ""}
                      placeholder={r.name}
                      onChange={(e) => setField(r.id, "corporateName", e.target.value)}
                      className="input-field w-full min-w-[12rem]"
                    />
                  </td>
                  <td
                    className="py-1.5 pr-3 text-xs text-slate-500 whitespace-nowrap"
                    title="科目名と区分から自動で振り分けます。予算管理の「設定」タブ（予算配分）で変えられます"
                  >
                    {ruleByAccount.get(r.id) ?? "—"}
                  </td>
                  <td className="py-1.5">
                    <button
                      type="button"
                      aria-label="この科目を削除"
                      title="削除"
                      onClick={() => deleteAccount(r)}
                      className="text-slate-300 hover:text-red-500"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  </td>
                </tr>
              ))}
              {/* 新規科目の追加行（コードは自動採番） */}
              <tr className="bg-slate-50/60">
                <td className="py-2 pr-3 text-xs text-slate-400 whitespace-nowrap">自動採番</td>
                <td className="py-2 pr-3">
                  <input
                    value={newName}
                    placeholder="追加する科目名"
                    onChange={(e) => setNewName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") addAccount();
                    }}
                    className="input-field w-full min-w-[10rem]"
                  />
                </td>
                <td className="py-2 pr-3">
                  <select
                    value={newCategory}
                    onChange={(e) => setNewCategory(e.target.value)}
                    className="input-field w-32"
                  >
                    {Object.entries(CATEGORY_LABEL).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="py-2 pr-3" colSpan={4}>
                  <button
                    type="button"
                    onClick={addAccount}
                    disabled={adding}
                    aria-label="科目を追加"
                    className="inline-flex items-center gap-1 text-sm font-medium text-indigo-600 hover:text-indigo-700 disabled:opacity-50"
                  >
                    <Plus className="w-4 h-4" aria-hidden="true" />
                    {adding ? "追加中…" : "科目を追加"}
                  </button>
                  <span className="ml-2 text-[11px] text-slate-400">
                    コードは同じ区分の既存コードから自動で採番されます。予算配分のルールにも、科目名と区分で自動で入ります。
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}
