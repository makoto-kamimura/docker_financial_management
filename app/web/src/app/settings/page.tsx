"use client";

import { Suspense, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useSearchParams } from "next/navigation";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { AppShell } from "@/components/AppShell";
import { LoadingSpinner } from "@/components/StateViews";
// 区分名は予算管理・実績管理と同じ（lib/labels.ts）
import { CATEGORY_LABEL } from "@/lib/labels";

// ── 共通型 ──────────────────────────────────────────────────────
type BusinessProfile = {
  id?: number;
  tradeName: string;
  ownerName: string;
  openedOn: string;
  blueReturn: boolean;
  invoiceNumber: string;
  taxationType: string;
};
type TaxSetting = { taxYear: number; taxationType: string; simplifiedRate: string };
// ── 定数 ────────────────────────────────────────────────────────
const TAX_TYPE_LABELS: Record<string, string> = {
  exempt: "免税事業者",
  general: "課税事業者（原則課税）",
  simplified: "課税事業者（簡易課税）",
};
const PAYMENT_METHODS: Record<string, string> = {
  exempt: "免税",
  general: "原則課税",
  simplified: "簡易課税",
};
// ── タブ型 ──────────────────────────────────────────────────────
type Tab = "profile" | "tax" | "security" | "accountNames" | "departments";

// ── 事業者情報セクション ─────────────────────────────────────────
function BusinessProfileSection() {
  const [form, setForm] = useState<BusinessProfile>({
    tradeName: "",
    ownerName: "",
    openedOn: "",
    blueReturn: false,
    invoiceNumber: "",
    taxationType: "exempt",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/business-profile")
      .then((r) => r.json())
      .then(({ data }) => {
        if (data)
          setForm({
            tradeName: data.tradeName ?? "",
            ownerName: data.ownerName ?? "",
            openedOn: data.openedOn ? data.openedOn.slice(0, 10) : "",
            blueReturn: data.blueReturn ?? false,
            invoiceNumber: data.invoiceNumber ?? "",
            taxationType: data.taxationType ?? "exempt",
          });
      });
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/business-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, openedOn: form.openedOn || null }),
    });
    setMsg(res.ok ? { ok: true, text: "保存しました" } : { ok: false, text: "保存に失敗しました" });
    setSaving(false);
  }

  const f = (field: keyof BusinessProfile, val: string | boolean) =>
    setForm((prev) => ({ ...prev, [field]: val }));

  return (
    <div className="card max-w-xl">
      <h2 className="section-title mb-4">事業者情報（F001）</h2>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">屋号</span>
            <input
              className="input-field mt-1 w-full"
              value={form.tradeName}
              onChange={(e) => f("tradeName", e.target.value)}
              placeholder="○○商店"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">氏名 *</span>
            <input
              className="input-field mt-1 w-full"
              value={form.ownerName}
              onChange={(e) => f("ownerName", e.target.value)}
              placeholder="山田 太郎"
            />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">開業日</span>
            <input
              type="date"
              className="input-field mt-1 w-full"
              value={form.openedOn}
              onChange={(e) => f("openedOn", e.target.value)}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">
              既定の課税方式（年度別設定が無い場合に使用）
            </span>
            <select
              className="input-field mt-1 w-full"
              value={form.taxationType}
              onChange={(e) => f("taxationType", e.target.value)}
            >
              {Object.entries(TAX_TYPE_LABELS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400 mt-1">
              「消費税設定」タブで対象年度の設定があれば、そちらが優先されます。
            </p>
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">インボイス登録番号</span>
          <input
            className="input-field mt-1 w-full"
            value={form.invoiceNumber}
            onChange={(e) => f("invoiceNumber", e.target.value)}
            placeholder="T1234567890123"
          />
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={form.blueReturn}
            onChange={(e) => f("blueReturn", e.target.checked)}
            className="w-4 h-4 rounded text-indigo-600"
          />
          <span className="text-sm text-slate-700">青色申告（65万円控除）</span>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="btn-primary text-sm px-4 py-1.5"
        >
          {saving ? "保存中…" : "保存"}
        </button>
        {msg && (
          <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>
        )}
      </div>
    </div>
  );
}

// ── 消費税設定セクション ─────────────────────────────────────────
function TaxSettingsSection() {
  const currentYear = new Date().getFullYear();
  const [settings, setSettings] = useState<TaxSetting[]>([]);
  const [form, setForm] = useState<TaxSetting>({
    taxYear: currentYear,
    taxationType: "exempt",
    simplifiedRate: "",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/tax-settings")
      .then((r) => r.json())
      .then(({ data }) => setSettings(data ?? []));
  }, []);

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/tax-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taxYear: form.taxYear,
        taxationType: form.taxationType,
        simplifiedRate: form.simplifiedRate ? Number(form.simplifiedRate) : null,
      }),
    });
    if (res.ok) {
      const { data } = await res.json();
      setSettings((prev) => {
        const idx = prev.findIndex((s) => s.taxYear === data.taxYear);
        const next = [...prev];
        if (idx >= 0) next[idx] = data;
        else next.unshift(data);
        return next;
      });
      setMsg({ ok: true, text: "保存しました" });
    } else {
      setMsg({ ok: false, text: "保存に失敗しました" });
    }
    setSaving(false);
  }

  return (
    <div className="card max-w-xl">
      <h2 className="section-title mb-4">消費税設定（F012）</h2>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">年度</span>
            <input
              type="number"
              className="input-field mt-1 w-full"
              value={form.taxYear}
              onChange={(e) => setForm((p) => ({ ...p, taxYear: Number(e.target.value) }))}
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">課税方式</span>
            <select
              className="input-field mt-1 w-full"
              value={form.taxationType}
              onChange={(e) => setForm((p) => ({ ...p, taxationType: e.target.value }))}
            >
              {Object.entries(PAYMENT_METHODS).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">みなし仕入率（%）</span>
            <input
              type="number"
              className="input-field mt-1 w-full"
              value={form.simplifiedRate}
              onChange={(e) => setForm((p) => ({ ...p, simplifiedRate: e.target.value }))}
              placeholder="60"
              disabled={form.taxationType !== "simplified"}
            />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="btn-primary text-sm px-4 py-1.5"
          >
            {saving ? "保存中…" : "年度設定を保存"}
          </button>
          {msg && (
            <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>
          )}
        </div>
      </div>
      {settings.length > 0 && (
        <table className="mt-4 w-full text-sm">
          <thead>
            <tr className="text-xs text-slate-500 border-b border-slate-100">
              <th className="text-left py-1.5 font-medium">年度</th>
              <th className="text-left py-1.5 font-medium">課税方式</th>
              <th className="text-left py-1.5 font-medium">みなし仕入率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {settings.map((s) => (
              <tr key={s.taxYear} className="hover:bg-slate-50">
                <td className="py-1.5 font-medium">{s.taxYear}年</td>
                <td className="py-1.5 text-slate-600">
                  {PAYMENT_METHODS[s.taxationType] ?? s.taxationType}
                </td>
                <td className="py-1.5 text-slate-600">
                  {s.simplifiedRate ? `${s.simplifiedRate}%` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── セキュリティセクション（MFA + リカバリー）────────────────────
function SecuritySection() {
  const qc = useQueryClient();

  // 現在のログインユーザー。MFA が有効かどうかで画面の出し分けをする
  const { data: me } = useQuery({
    queryKey: ["auth-me"],
    queryFn: async (): Promise<{ mfaEnabled: boolean } | null> => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return null;
      return (await res.json()).user ?? null;
    },
  });
  const mfaEnabled = me?.mfaEnabled ?? false;

  // MFA セットアップ
  const [secret, setSecret] = useState<string | null>(null);
  const [uri, setUri] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [mfaMsg, setMfaMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function setup() {
    setMfaMsg(null);
    const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
    if (!res.ok) return setMfaMsg({ ok: false, text: "セットアップに失敗しました。" });
    const json = await res.json();
    setSecret(json.secret);
    setUri(json.otpauthUri);
  }

  async function enable() {
    const res = await fetch("/api/auth/mfa/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    if (res.ok) {
      setSecret(null);
      setUri(null);
      setCode("");
      setMfaMsg({ ok: true, text: "MFA を有効化しました。" });
      qc.invalidateQueries({ queryKey: ["auth-me"] });
    } else {
      setMfaMsg({ ok: false, text: "コードが正しくありません。" });
    }
  }

  // MFA 解除。認証アプリのコードで本人確認したうえで無効化する
  // （サーバ側でシークレットとリカバリーコードを破棄する）
  const [disableCode, setDisableCode] = useState("");
  const [disabling, setDisabling] = useState(false);

  async function disable() {
    if (
      !confirm(
        "MFA を解除します。以後はパスワードだけでログインできるようになり、" +
          "発行済みのリカバリーコードも使えなくなります。よろしいですか？",
      )
    )
      return;
    setDisabling(true);
    setMfaMsg(null);
    const res = await fetch("/api/auth/mfa/disable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: disableCode }),
    });
    setDisabling(false);
    setDisableCode("");
    if (res.ok) {
      setSecret(null);
      setUri(null);
      setCode("");
      setMfaMsg({
        ok: true,
        text: "MFA を解除しました。再度有効にする場合は改めて設定してください。",
      });
      qc.invalidateQueries({ queryKey: ["auth-me"] });
    } else {
      setMfaMsg({ ok: false, text: "コードが正しくありません。" });
    }
  }

  // リカバリーコード
  const [totpCode, setTotpCode] = useState("");
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [generating, setGenerating] = useState(false);
  const [recMsg, setRecMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function generateRecovery() {
    if (!confirm("既存のリカバリーコードはすべて無効になります。よろしいですか？")) return;
    setGenerating(true);
    setRecMsg(null);
    setRecoveryCodes(null);
    const res = await fetch("/api/auth/mfa/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totp: totpCode }),
    });
    const json = await res.json();
    if (res.ok) {
      setRecoveryCodes(json.codes);
      setRecMsg({ ok: true, text: json.message });
    } else {
      setRecMsg({ ok: false, text: json.error ?? "生成に失敗しました" });
    }
    setGenerating(false);
    setTotpCode("");
  }

  return (
    <div className="space-y-6 max-w-lg">
      {/* MFA セットアップ */}
      <div className="card">
        <div className="flex items-center gap-3 mb-1">
          <h2 className="section-title mb-0">多要素認証（MFA / TOTP）</h2>
          <span
            className={`text-xs font-medium rounded-full px-2 py-0.5 border ${
              mfaEnabled
                ? "text-green-700 bg-green-50 border-green-200"
                : "text-slate-500 bg-slate-50 border-slate-200"
            }`}
          >
            {mfaEnabled ? "有効" : "無効"}
          </span>
        </div>
        <ol className="space-y-1 text-sm text-slate-600 mt-3 mb-4 list-decimal list-inside">
          <li>「シークレット発行」を押す</li>
          <li>表示されたシークレットを認証アプリに登録</li>
          <li>アプリに表示された 6 桁コードを入力して有効化</li>
        </ol>
        <button type="button" onClick={setup} className="btn-primary">
          {mfaEnabled ? "シークレットを再発行（認証アプリの登録し直し）" : "シークレット発行"}
        </button>
        {mfaEnabled && (
          <p className="mt-2 text-xs text-slate-400">
            再発行すると新しいシークレットに切り替わります。有効化するまでは今の認証アプリのコードが有効です。
          </p>
        )}
        {secret && (
          <div className="mt-5 space-y-4 pt-5 border-t border-slate-100">
            <div>
              <p className="text-xs font-medium text-slate-500 mb-1">シークレット</p>
              <code className="block bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-800 break-all">
                {secret}
              </code>
            </div>
            {uri && (
              <div>
                <p className="text-xs font-medium text-slate-500 mb-1">otpauth URI</p>
                <p className="text-xs text-slate-400 break-all leading-relaxed">{uri}</p>
              </div>
            )}
            <div className="flex gap-2">
              <input
                placeholder="6 桁コード"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                maxLength={6}
                className="input-field w-36 text-center tracking-widest font-mono"
              />
              <button type="button" onClick={enable} className="btn-primary">
                有効化
              </button>
            </div>
          </div>
        )}
        {/* 解除。認証アプリを機種変更・削除する前にここで無効化する。
            本人確認のため現在の 6 桁コードを求める（サーバ側でも検証する）。 */}
        {mfaEnabled && (
          <div className="mt-5 pt-5 border-t border-slate-100">
            <p className="text-xs font-medium text-slate-500 mb-1">MFA の解除</p>
            <p className="text-xs text-slate-400 mb-3">
              認証アプリのコードで本人確認のうえ無効化します。シークレットと発行済みの
              リカバリーコードは破棄されるため、再び有効にするときは登録し直しになります。
            </p>
            <div className="flex gap-2">
              <input
                placeholder="6 桁コード"
                value={disableCode}
                onChange={(e) => setDisableCode(e.target.value)}
                maxLength={6}
                className="input-field w-36 text-center tracking-widest font-mono"
              />
              <button
                type="button"
                onClick={disable}
                disabled={disabling || disableCode.length !== 6}
                className="px-4 py-2 text-sm font-medium rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 disabled:hover:bg-transparent"
              >
                {disabling ? "解除中…" : "MFA を解除"}
              </button>
            </div>
          </div>
        )}
        {mfaMsg && (
          <p
            className={`mt-4 text-sm rounded-lg px-3 py-2 border ${mfaMsg.ok ? "text-green-700 bg-green-50 border-green-200" : "text-red-600 bg-red-50 border-red-200"}`}
          >
            {mfaMsg.text}
          </p>
        )}
      </div>

      {/* リカバリーコード */}
      <div className="card">
        <h2 className="section-title">MFA リカバリーコード</h2>
        <p className="text-sm text-slate-500 mb-4">
          MFA 認証デバイスを紛失した場合に使用できる使い捨てコードです。MFA 有効化後に発行できます。
        </p>
        <div className="flex gap-2 mb-4">
          <input
            placeholder="現在の TOTP コード（6桁）"
            value={totpCode}
            onChange={(e) => setTotpCode(e.target.value)}
            maxLength={6}
            className="input-field w-40 text-center tracking-widest font-mono"
          />
          <button
            type="button"
            onClick={generateRecovery}
            // MFA が無効なときはサーバが 400 を返すので、押せないようにしておく
            disabled={generating || totpCode.length !== 6 || !mfaEnabled}
            title={mfaEnabled ? undefined : "MFA を有効化すると発行できます"}
            className="btn-primary text-sm px-3 py-1.5 disabled:opacity-50"
          >
            {generating ? "生成中…" : "リカバリーコードを発行"}
          </button>
        </div>
        {recoveryCodes && (
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4">
            <p className="text-xs font-semibold text-amber-700 mb-3">
              以下のコードを安全な場所に保管してください（再表示不可・各コードは1回のみ使用可）
            </p>
            <div className="grid grid-cols-2 gap-1">
              {recoveryCodes.map((c, i) => (
                <code
                  key={i}
                  className="bg-white border border-amber-200 rounded px-2 py-1 text-xs font-mono text-slate-800"
                >
                  {c}
                </code>
              ))}
            </div>
          </div>
        )}
        {recMsg && (
          <p
            className={`text-sm rounded-lg px-3 py-2 border ${recMsg.ok ? "text-green-700 bg-green-50 border-green-200" : "text-red-600 bg-red-50 border-red-200"}`}
          >
            {recMsg.text}
          </p>
        )}
      </div>
    </div>
  );
}

// ── 科目名設定セクション（モード別表示名の管理）──────────────────
type AccountNameRow = {
  id: number;
  code: string;
  name: string;
  soleName: string | null;
  corporateName: string | null;
  category: string;
};

function AccountNamesSection() {
  const [rows, setRows] = useState<AccountNameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // 変更中の行（家庭科目名・区分・モード別表示名）
  type NameEdit = {
    code: string;
    name: string;
    category: string;
    soleName: string;
    corporateName: string;
  };
  const [dirty, setDirty] = useState<Record<number, NameEdit>>({});

  const load = () => {
    setLoading(true);
    fetch("/api/accounts")
      .then((r) => r.json())
      .then((j) => {
        setRows(j.data ?? []);
        setDirty({});
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
    <div className="card">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h2 className="section-title">科目名設定</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            家庭科目名と区分（収入・固定費など）、および個人事業主モード・法人モードでの表示名をここで変更できます。
            モード別表示名を空欄にすると家庭科目名がそのまま使われます。既定値は勘定科目変換マスタ（account-master-mapping.md）に基づきます。
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving || dirtyCount === 0}
          className="btn-primary px-4 py-2 whitespace-nowrap disabled:opacity-50"
        >
          {saving ? "保存中…" : dirtyCount > 0 ? `変更を保存 (${dirtyCount})` : "変更を保存"}
        </button>
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
                <td className="py-2 pr-3" colSpan={3}>
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
                    コードは同じ区分の既存コードから自動で採番されます。
                  </span>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 部門・担当（実績管理のマスタ管理から移設）─────────────────────
type Department = { id: number; name: string; manager: string | null };

function DepartmentsSection() {
  const qc = useQueryClient();
  const [form, setForm] = useState({ name: "", manager: "" });
  const [editItem, setEditItem] = useState<Department | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const { data: departments } = useQuery({
    queryKey: ["departments"],
    queryFn: async (): Promise<Department[]> =>
      (await (await fetch("/api/departments")).json()).data ?? [],
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["departments"] });

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null);
    const res = await fetch("/api/departments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: form.name, ...(form.manager ? { manager: form.manager } : {}) }),
    });
    if (res.ok) {
      setForm({ name: "", manager: "" });
      invalidate();
    } else {
      setMsg({ ok: false, text: "部門の追加に失敗しました。" });
    }
  }

  async function saveEdit() {
    if (!editItem) return;
    await fetch(`/api/departments/${editItem.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: editItem.name, manager: editItem.manager ?? "" }),
    });
    setEditItem(null);
    invalidate();
  }

  async function remove(d: Department) {
    if (!confirm(`「${d.name}」を削除してよいですか？`)) return;
    const res = await fetch(`/api/departments/${d.id}`, { method: "DELETE" });
    if (res.ok) invalidate();
    else {
      const err = await res.json().catch(() => ({}));
      setMsg({ ok: false, text: err.error ?? "部門の削除に失敗しました。" });
    }
  }

  return (
    <>
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-5 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-slate-800 mb-3">部門を編集</h3>
            <div className="space-y-2">
              <input
                className="input-field w-full"
                value={editItem.name}
                onChange={(e) => setEditItem({ ...editItem, name: e.target.value })}
                placeholder="部門名"
              />
              <input
                className="input-field w-full"
                value={editItem.manager ?? ""}
                onChange={(e) => setEditItem({ ...editItem, manager: e.target.value })}
                placeholder="担当者名（任意）"
              />
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={saveEdit} className="btn-primary flex-1 py-1.5 text-sm">
                保存
              </button>
              <button
                onClick={() => setEditItem(null)}
                className="btn-secondary flex-1 py-1.5 text-sm"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="card max-w-2xl">
        <h2 className="section-title mb-1">部門・担当</h2>
        <p className="text-xs text-slate-500 mb-4">
          実績を部門別に集計する場合に登録します（実績管理のマスタ管理から移設）。
        </p>

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

        <form onSubmit={add} className="flex gap-2 mb-4 flex-wrap">
          <input
            placeholder="部門名"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
            required
            className="input-field flex-1 min-w-32"
          />
          <input
            placeholder="担当者名（任意）"
            value={form.manager}
            onChange={(e) => setForm({ ...form, manager: e.target.value })}
            className="input-field w-36"
          />
          <button type="submit" className="btn-primary px-4 inline-flex items-center gap-1">
            <Plus className="w-4 h-4" aria-hidden="true" />
            追加
          </button>
        </form>

        <ul className="divide-y divide-slate-100">
          {(departments ?? []).length === 0 && (
            <p className="text-xs text-slate-400 py-3">登録なし</p>
          )}
          {(departments ?? []).map((d) => (
            <li key={d.id} className="flex items-center gap-2 py-2 group">
              <span className="text-sm text-slate-800 flex-1">{d.name}</span>
              {d.manager && (
                <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                  担当: {d.manager}
                </span>
              )}
              <button
                type="button"
                aria-label="この部門を編集"
                title="編集"
                onClick={() => setEditItem(d)}
                className="text-slate-300 hover:text-indigo-500 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                aria-label="この部門を削除"
                title="削除"
                onClick={() => remove(d)}
                className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

// ── メインページ ─────────────────────────────────────────────────
const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "基本設定" },
  { id: "tax", label: "消費税設定" },
  { id: "accountNames", label: "科目名設定" },
  { id: "departments", label: "部門・担当" },
  { id: "security", label: "セキュリティ" },
];

function SettingsContent() {
  const searchParams = useSearchParams();
  // 他画面から ?tab=departments のように開けるようにする
  // （予算配分ルールと口座・カード管理は、それぞれ予算管理・銀行/カード管理へ移設した）
  const initialTab = TABS.some((t) => t.id === searchParams.get("tab"))
    ? (searchParams.get("tab") as Tab)
    : "profile";
  const [tab, setTab] = useState<Tab>(initialTab);

  return (
    <AppShell>
      <div className="mb-5">
        <h1 className="page-title">設定</h1>
      </div>

      {/* タブ */}
      <div className="flex gap-1 mb-6 border-b border-slate-200">
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors whitespace-nowrap ${
              tab === id
                ? "border-indigo-500 text-indigo-600"
                : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "profile" && <BusinessProfileSection />}
      {tab === "tax" && <TaxSettingsSection />}
      {tab === "accountNames" && <AccountNamesSection />}
      {tab === "departments" && <DepartmentsSection />}
      {tab === "security" && <SecuritySection />}
    </AppShell>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <SettingsContent />
    </Suspense>
  );
}
