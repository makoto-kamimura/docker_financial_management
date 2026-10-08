"use client";

// ユーザー管理（admin のみ）。借入金管理・銀行管理と同じく、1 枚のカードに枠線つきの行で並べ、
// 追加と編集はモーダルで行う。表示名は画面の右上・監査ログにも出る（本人は設定の基本設定から変えられる）。

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";
import { SectionLead } from "@/components/Explain";
import { Notice, PageHeader } from "@/components/ui";
import { ADMIN_HELP } from "@/lib/help-texts";

type RoleType = "admin" | "editor" | "viewer";
type User = {
  id: number;
  email: string;
  name: string;
  role: RoleType;
  mfaEnabled: boolean;
  createdAt: string;
};

const ROLE_BADGE: Record<RoleType, string> = {
  admin: "bg-red-50 text-red-700",
  editor: "bg-amber-50 text-amber-700",
  viewer: "bg-slate-100 text-slate-600",
};
const ROLE_LABEL: Record<RoleType, string> = {
  admin: "管理者",
  editor: "編集者",
  viewer: "閲覧者",
};
const ROLE_OPTIONS: [RoleType, string][] = [
  ["viewer", "閲覧者 (viewer)"],
  ["editor", "編集者 (editor)"],
  ["admin", "管理者 (admin)"],
];

type CreateForm = {
  email: string;
  name: string;
  role: RoleType;
  password: string;
  newTenant: boolean;
};
const BLANK_CREATE: CreateForm = {
  email: "",
  name: "",
  role: "viewer",
  password: "",
  newTenant: false,
};
type EditForm = { user: User; name: string; role: RoleType; password: string };

export default function AdminUsersPage() {
  const qc = useQueryClient();
  const [create, setCreate] = useState<CreateForm | null>(null);
  const [edit, setEdit] = useState<EditForm | null>(null);
  const [error, setError] = useState<string | null>(null);

  const {
    data: users,
    isLoading,
    error: loadError,
  } = useQuery({
    queryKey: ["admin-users"],
    queryFn: async (): Promise<User[]> => {
      const res = await fetch("/api/admin/users");
      if (!res.ok) throw new Error("forbidden");
      return (await res.json()).data ?? [];
    },
    retry: false,
  });

  async function saveCreate() {
    if (!create) return;
    setError(null);
    const res = await fetch("/api/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(create),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(typeof d.error === "string" ? d.error : "登録に失敗しました");
      return;
    }
    setCreate(null);
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  async function saveEdit() {
    if (!edit) return;
    setError(null);
    const body: Record<string, string> = { role: edit.role };
    if (edit.name.trim() && edit.name !== edit.user.name) body.name = edit.name.trim();
    if (edit.password) body.password = edit.password;
    const res = await fetch(`/api/admin/users/${edit.user.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      setError(typeof d.error === "string" ? d.error : "保存に失敗しました");
      return;
    }
    setEdit(null);
    qc.invalidateQueries({ queryKey: ["admin-users"] });
    qc.invalidateQueries({ queryKey: ["auth-me"] });
  }

  async function deleteUser(u: User) {
    if (!confirm(`「${u.name}」を削除してよいですか？この操作は取り消せません。`)) return;
    const res = await fetch(`/api/admin/users/${u.id}`, { method: "DELETE" });
    if (!res.ok) {
      const d = await res.json().catch(() => ({}));
      alert(d.error ?? "削除に失敗しました");
      return;
    }
    qc.invalidateQueries({ queryKey: ["admin-users"] });
  }

  return (
    <AppShell>
      <PageHeader title="ユーザー管理" lead={ADMIN_HELP.users} />

      {loadError && <Notice tone="error">閲覧権限がありません（admin ロールが必要です）。</Notice>}

      {!loadError && (
        <section className="card mb-6">
          {/* 説明が長くても「ユーザー追加」が右端に残るよう、折り返さない並びにする */}
          <div className="flex items-start gap-3 mb-4">
            <div className="min-w-0 flex-1">
              <h2 className="section-title mb-1">ユーザー</h2>
              <SectionLead className="mb-0">{ADMIN_HELP.userList}</SectionLead>
            </div>
            <button
              type="button"
              onClick={() => {
                setError(null);
                setCreate(BLANK_CREATE);
              }}
              className="btn-primary shrink-0"
            >
              ユーザー追加
            </button>
          </div>
          {isLoading ? (
            <LoadingSpinner />
          ) : (
            <div className="space-y-2">
              {users?.map((u) => (
                <div
                  key={u.id}
                  className="border border-slate-100 rounded-lg px-3 py-3 flex flex-wrap items-center gap-3"
                >
                  <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center text-indigo-700 font-semibold text-sm shrink-0">
                    {u.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium text-slate-800 text-sm">{u.name}</h3>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${ROLE_BADGE[u.role]}`}
                      >
                        {ROLE_LABEL[u.role]}
                      </span>
                      {u.mfaEnabled && (
                        <span className="text-xs bg-green-50 text-green-700 px-1.5 py-0.5 rounded-full">
                          MFA
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-slate-400 truncate mt-0.5">
                      {u.email} ・ 登録 {new Date(u.createdAt).toLocaleDateString("ja-JP")}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setError(null);
                        setEdit({ user: u, name: u.name, role: u.role, password: "" });
                      }}
                      className="text-xs text-indigo-500 hover:text-indigo-700"
                    >
                      編集
                    </button>
                    <button
                      type="button"
                      onClick={() => deleteUser(u)}
                      className="text-xs text-red-400 hover:text-red-600"
                    >
                      削除
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* ユーザー追加 */}
      {create && (
        <Modal
          title="ユーザー追加"
          onClose={() => setCreate(null)}
          onSave={saveCreate}
          saveLabel="作成"
        >
          <Field label="表示名">
            <input
              placeholder="山田 太郎"
              className="input-field w-full"
              value={create.name}
              onChange={(e) => setCreate({ ...create, name: e.target.value })}
            />
          </Field>
          <Field label="メールアドレス">
            <input
              type="email"
              placeholder="user@example.com"
              className="input-field w-full"
              value={create.email}
              onChange={(e) => setCreate({ ...create, email: e.target.value })}
            />
          </Field>
          <Field label="ロール">
            <select
              className="input-field w-full"
              value={create.role}
              onChange={(e) => setCreate({ ...create, role: e.target.value as RoleType })}
            >
              {ROLE_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="初期パスワード">
            <input
              type="password"
              placeholder="8文字以上"
              className="input-field w-full"
              value={create.password}
              onChange={(e) => setCreate({ ...create, password: e.target.value })}
            />
          </Field>
          <label className="flex items-start gap-2 text-xs text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={create.newTenant}
              onChange={(e) => setCreate({ ...create, newTenant: e.target.checked })}
            />
            <span>
              専用の新規テナントを作成する
              <span className="block text-slate-400">{ADMIN_HELP.newTenant}</span>
            </span>
          </label>
          {error && <Notice tone="error">{error}</Notice>}
        </Modal>
      )}

      {/* ユーザーの編集（表示名・ロール・パスワード） */}
      {edit && (
        <Modal
          title={`${edit.user.name} を編集`}
          subtitle={edit.user.email}
          onClose={() => setEdit(null)}
          onSave={saveEdit}
          saveLabel="保存"
        >
          <Field label="表示名">
            <input
              className="input-field w-full"
              maxLength={50}
              value={edit.name}
              onChange={(e) => setEdit({ ...edit, name: e.target.value })}
            />
          </Field>
          <Field label="ロール">
            <select
              className="input-field w-full"
              value={edit.role}
              onChange={(e) => setEdit({ ...edit, role: e.target.value as RoleType })}
            >
              {ROLE_OPTIONS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="新しいパスワード（変更する場合のみ）">
            <input
              type="password"
              className="input-field w-full"
              placeholder="8文字以上"
              value={edit.password}
              onChange={(e) => setEdit({ ...edit, password: e.target.value })}
            />
          </Field>
          {error && <Notice tone="error">{error}</Notice>}
        </Modal>
      )}
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-600 mb-1">{label}</label>
      {children}
    </div>
  );
}

// 銀行追加・借入追加と同じ形のモーダル
function Modal({
  title,
  subtitle,
  onClose,
  onSave,
  saveLabel,
  children,
}: {
  title: string;
  subtitle?: string;
  onClose: () => void;
  onSave: () => void;
  saveLabel: string;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md max-h-[90vh] overflow-y-auto">
        <h2 className="text-lg font-bold text-slate-800 mb-1">{title}</h2>
        {subtitle && <p className="text-xs text-slate-500 mb-4">{subtitle}</p>}
        <div className="space-y-3 mt-3">{children}</div>
        <div className="flex justify-end gap-2 mt-5">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
          >
            キャンセル
          </button>
          <button type="button" onClick={onSave} className="btn-primary">
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
