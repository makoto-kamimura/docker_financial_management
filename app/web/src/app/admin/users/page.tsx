"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";

type User = {
  id: number;
  email: string;
  name: string;
  role: "admin" | "editor" | "viewer";
  mfaEnabled: boolean;
  createdAt: string;
};

const ROLE_BADGE: Record<string, string> = {
  admin:  "bg-red-50 text-red-700",
  editor: "bg-amber-50 text-amber-700",
  viewer: "bg-slate-100 text-slate-600",
};
const ROLE_LABEL: Record<string, string> = { admin: "管理者", editor: "編集者", viewer: "閲覧者" };

type RoleType = "admin" | "editor" | "viewer";
type UserForm = { email: string; name: string; role: RoleType; password: string };
const BLANK_FORM: UserForm = { email: "", name: "", role: "viewer", password: "" };

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const [form, setForm] = useState<UserForm>(BLANK_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [editUser, setEditUser] = useState<User | null>(null);
  const [editRole, setEditRole] = useState<string>("viewer");
  const [resetPw, setResetPw] = useState("");

  const { data: users, isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<User[]> => {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("forbidden");
      return (await res.json()).data ?? [];
    },
  });

  async function createUser(e: { preventDefault(): void }) {
    e.preventDefault();
    setFormError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    if (!res.ok) {
      const d = await res.json();
      setFormError(typeof d.error === "string" ? d.error : "登録に失敗しました");
      return;
    }
    setForm(BLANK_FORM);
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  async function saveEdit() {
    if (!editUser) return;
    const body: Record<string, string> = { role: editRole };
    if (resetPw) body.password = resetPw;
    await fetch(`/api/admin/users/${editUser.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setEditUser(null);
    setResetPw("");
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  async function deleteUser(u: User) {
    if (!confirm(`「${u.name}」を削除してよいですか？この操作は取り消せません。`)) return;
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json();
      alert(d.error ?? "削除に失敗しました");
      return;
    }
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  return (
    <AppShell>
      {/* 編集モーダル */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 w-80">
            <h3 className="text-sm font-semibold text-slate-800 mb-1">{editUser.name} を編集</h3>
            <p className="text-xs text-slate-400 mb-4">{editUser.email}</p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-slate-500 mb-1 block">ロール</label>
                <select className="input-field w-full" value={editRole}
                  onChange={(e) => setEditRole(e.target.value)}>
                  <option value="admin">管理者 (admin)</option>
                  <option value="editor">編集者 (editor)</option>
                  <option value="viewer">閲覧者 (viewer)</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-slate-500 mb-1 block">新しいパスワード（変更する場合のみ）</label>
                <input type="password" className="input-field w-full" placeholder="8文字以上"
                  value={resetPw} onChange={(e) => setResetPw(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveEdit} className="btn-primary flex-1 py-1.5 text-sm">保存</button>
              <button onClick={() => { setEditUser(null); setResetPw(""); }}
                className="btn-secondary flex-1 py-1.5 text-sm">キャンセル</button>
            </div>
          </div>
        </div>
      )}

      <div className="mb-6">
        <h1 className="page-title">ユーザー管理</h1>
        <p className="text-sm text-slate-500 mt-0.5">ユーザーの一覧・ロール変更・新規作成</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ユーザー一覧 */}
        <div className="card lg:col-span-2">
          <h2 className="section-title">ユーザー一覧</h2>
          {isLoading && <LoadingSpinner />}
          <ul className="divide-y divide-slate-100 mt-2">
            {users?.map((u) => (
              <li key={u.id} className="flex items-center gap-3 py-3 group">
                <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm shrink-0">
                  {u.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-800">{u.name}</p>
                  <p className="text-xs text-slate-400 truncate">{u.email}</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  {u.mfaEnabled && (
                    <span className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">MFA</span>
                  )}
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE[u.role]}`}>
                    {ROLE_LABEL[u.role]}
                  </span>
                  <button
                    onClick={() => { setEditUser(u); setEditRole(u.role); }}
                    className="text-xs text-slate-400 hover:text-indigo-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="編集"
                  >✏️</button>
                  <button
                    onClick={() => deleteUser(u)}
                    className="text-xs text-slate-400 hover:text-red-600 opacity-0 group-hover:opacity-100 transition-opacity"
                    title="削除"
                  >🗑</button>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* 新規作成フォーム */}
        <div className="card">
          <h2 className="section-title">新規ユーザー作成</h2>
          <form onSubmit={createUser} className="space-y-3 mt-3">
            <div>
              <label className="text-xs text-slate-500 mb-1 block">氏名</label>
              <input placeholder="山田 太郎" required className="input-field w-full"
                value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">メールアドレス</label>
              <input type="email" placeholder="user@example.com" required className="input-field w-full"
                value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">ロール</label>
              <select className="input-field w-full" value={form.role}
                onChange={(e) => setForm({ ...form, role: e.target.value as "admin" | "editor" | "viewer" })}>
                <option value="viewer">閲覧者 (viewer)</option>
                <option value="editor">編集者 (editor)</option>
                <option value="admin">管理者 (admin)</option>
              </select>
            </div>
            <div>
              <label className="text-xs text-slate-500 mb-1 block">初期パスワード</label>
              <input type="password" placeholder="8文字以上" required minLength={8} className="input-field w-full"
                value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
            </div>
            {formError && (
              <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded px-2 py-1.5">{formError}</p>
            )}
            <button type="submit" className="btn-primary w-full py-2">作成</button>
          </form>
        </div>
      </div>
    </AppShell>
  );
}
