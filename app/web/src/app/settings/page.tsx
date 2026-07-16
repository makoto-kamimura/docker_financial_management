"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";

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
type AccountRef = { id: number; code: string; name: string; category: string };
type LinkedAccount = {
  id: number;
  name: string;
  type: "BANK" | "CREDIT_CARD";
  institution: string;
  lastFour: string | null;
  accountId: number | null;
  account: AccountRef | null;
  note: string | null;
};

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
const TYPE_LABEL = { BANK: "銀行口座", CREDIT_CARD: "クレジットカード" } as const;
const TYPE_BADGE = {
  BANK: "bg-blue-50 text-blue-700",
  CREDIT_CARD: "bg-violet-50 text-violet-700",
} as const;

// ── タブ型 ──────────────────────────────────────────────────────
type Tab = "profile" | "tax" | "security" | "accounts" | "accountNames" | "allocationRules";

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
            <span className="text-xs font-medium text-slate-600">消費税課税方式</span>
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
    setMfaMsg(
      res.ok
        ? { ok: true, text: "MFA を有効化しました。" }
        : { ok: false, text: "コードが正しくありません。" },
    );
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
        <h2 className="section-title">多要素認証（MFA / TOTP）</h2>
        <ol className="space-y-1 text-sm text-slate-600 mb-4 list-decimal list-inside">
          <li>「シークレット発行」を押す</li>
          <li>表示されたシークレットを認証アプリに登録</li>
          <li>アプリに表示された 6 桁コードを入力して有効化</li>
        </ol>
        <button type="button" onClick={setup} className="btn-primary">
          シークレット発行
        </button>
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
            disabled={generating || totpCode.length !== 6}
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

// ── 口座・カード管理セクション ───────────────────────────────────
type FormState = {
  name: string;
  type: "BANK" | "CREDIT_CARD";
  institution: string;
  lastFour: string;
  accountCode: string;
  note: string;
};
const BLANK: FormState = {
  name: "",
  type: "BANK",
  institution: "",
  lastFour: "",
  accountCode: "",
  note: "",
};

function LinkedAccountsSection() {
  const qc = useQueryClient();

  const { data: items } = useQuery({
    queryKey: ["linked-accounts"],
    queryFn: async (): Promise<LinkedAccount[]> =>
      (await (await fetch("/api/linked-accounts")).json()).data ?? [],
  });

  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<AccountRef[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });

  const [form, setForm] = useState(BLANK);
  const [editItem, setEditItem] = useState<LinkedAccount | null>(null);

  const assetAccounts =
    accounts?.filter((a) => a.category === "ASSET" || a.category === "LIABILITY") ?? [];
  const banks = items?.filter((i) => i.type === "BANK") ?? [];
  const cards = items?.filter((i) => i.type === "CREDIT_CARD") ?? [];

  async function addItem(e: React.FormEvent) {
    e.preventDefault();
    const body: Record<string, string> = {
      name: form.name,
      type: form.type,
      institution: form.institution,
    };
    if (form.lastFour) body.lastFour = form.lastFour;
    if (form.accountCode) body.accountCode = form.accountCode;
    if (form.note) body.note = form.note;
    await fetch("/api/linked-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    setForm(BLANK);
    qc.invalidateQueries({ queryKey: ["linked-accounts"] });
  }

  async function saveEdit() {
    if (!editItem) return;
    await fetch(`/api/linked-accounts/${editItem.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: editItem.name,
        type: editItem.type,
        institution: editItem.institution,
        lastFour: editItem.lastFour ?? "",
        accountCode: editItem.account?.code ?? "",
        note: editItem.note ?? "",
      }),
    });
    setEditItem(null);
    qc.invalidateQueries({ queryKey: ["linked-accounts"] });
  }

  async function deleteItem(item: LinkedAccount) {
    if (!confirm(`「${item.name}」を削除してよいですか？`)) return;
    await fetch(`/api/linked-accounts/${item.id}`, { method: "DELETE" });
    qc.invalidateQueries({ queryKey: ["linked-accounts"] });
  }

  const ItemList = ({ list }: { list: LinkedAccount[] }) => (
    <ul className="divide-y divide-slate-100">
      {list.length === 0 && <p className="text-xs text-slate-400 py-3">登録なし</p>}
      {list.map((item) => (
        <li key={item.id} className="py-3 group flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-medium text-slate-800">{item.name}</span>
              <span className={`text-xs px-1.5 py-0.5 rounded-full ${TYPE_BADGE[item.type]}`}>
                {TYPE_LABEL[item.type]}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {item.institution}
              {item.lastFour ? ` ****${item.lastFour}` : ""}
            </p>
            {item.account && (
              <p className="text-xs text-indigo-600 mt-0.5">
                → {item.account.code} {item.account.name}
              </p>
            )}
            {item.note && <p className="text-xs text-slate-400 mt-0.5">{item.note}</p>}
          </div>
          <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
            <button
              onClick={() => setEditItem(item)}
              className="text-xs text-slate-400 hover:text-indigo-600"
            >
              ✏️
            </button>
            <button
              onClick={() => deleteItem(item)}
              className="text-xs text-slate-400 hover:text-red-600"
            >
              🗑
            </button>
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <>
      {/* 編集モーダル */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="bg-white rounded-xl shadow-xl p-6 w-96">
            <h3 className="text-sm font-semibold text-slate-800 mb-4">口座・カードを編集</h3>
            <div className="space-y-3">
              <input
                className="input-field w-full"
                placeholder="名称"
                value={editItem.name}
                onChange={(e) => setEditItem({ ...editItem, name: e.target.value })}
              />
              <select
                className="input-field w-full"
                value={editItem.type}
                onChange={(e) =>
                  setEditItem({ ...editItem, type: e.target.value as "BANK" | "CREDIT_CARD" })
                }
              >
                <option value="BANK">銀行口座</option>
                <option value="CREDIT_CARD">クレジットカード</option>
              </select>
              <input
                className="input-field w-full"
                placeholder="金融機関名"
                value={editItem.institution}
                onChange={(e) => setEditItem({ ...editItem, institution: e.target.value })}
              />
              <input
                className="input-field w-full"
                placeholder="下4桁（任意）"
                maxLength={4}
                value={editItem.lastFour ?? ""}
                onChange={(e) => setEditItem({ ...editItem, lastFour: e.target.value })}
              />
              <select
                className="input-field w-full"
                value={editItem.account?.code ?? ""}
                onChange={(e) => {
                  const acct = assetAccounts.find((a) => a.code === e.target.value) ?? null;
                  setEditItem({ ...editItem, account: acct, accountId: acct?.id ?? null });
                }}
              >
                <option value="">勘定科目と紐付けない</option>
                {assetAccounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
              <input
                className="input-field w-full"
                placeholder="メモ（任意）"
                value={editItem.note ?? ""}
                onChange={(e) => setEditItem({ ...editItem, note: e.target.value })}
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

      <div className="space-y-5">
        {/* 登録フォーム */}
        <div className="card">
          <h2 className="section-title mb-4">新規登録</h2>
          <form onSubmit={addItem} className="flex gap-2 flex-wrap items-end">
            <div className="flex flex-col gap-1 min-w-28">
              <label className="text-xs text-slate-500">名称</label>
              <input
                placeholder="例: 住信SBI普通"
                value={form.name}
                required
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                className="input-field"
              />
            </div>
            <div className="flex flex-col gap-1 w-32">
              <label className="text-xs text-slate-500">種別</label>
              <select
                value={form.type}
                onChange={(e) =>
                  setForm({ ...form, type: e.target.value as "BANK" | "CREDIT_CARD" })
                }
                className="input-field"
              >
                <option value="BANK">銀行口座</option>
                <option value="CREDIT_CARD">クレジットカード</option>
              </select>
            </div>
            <div className="flex flex-col gap-1 min-w-28">
              <label className="text-xs text-slate-500">金融機関</label>
              <input
                placeholder="例: 住信SBIネット銀行"
                value={form.institution}
                required
                onChange={(e) => setForm({ ...form, institution: e.target.value })}
                className="input-field"
              />
            </div>
            <div className="flex flex-col gap-1 w-20">
              <label className="text-xs text-slate-500">下4桁</label>
              <input
                placeholder="1234"
                maxLength={4}
                value={form.lastFour}
                onChange={(e) => setForm({ ...form, lastFour: e.target.value })}
                className="input-field"
              />
            </div>
            <div className="flex flex-col gap-1 min-w-36">
              <label className="text-xs text-slate-500">紐付き勘定科目</label>
              <select
                value={form.accountCode}
                onChange={(e) => setForm({ ...form, accountCode: e.target.value })}
                className="input-field"
              >
                <option value="">なし</option>
                {assetAccounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.code} {a.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1 flex-1 min-w-24">
              <label className="text-xs text-slate-500">メモ</label>
              <input
                placeholder="任意"
                value={form.note}
                onChange={(e) => setForm({ ...form, note: e.target.value })}
                className="input-field"
              />
            </div>
            <button type="submit" className="btn-primary px-4">
              追加
            </button>
          </form>
        </div>

        {/* 一覧 */}
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="card">
            <div className="flex items-center justify-between mb-1">
              <h2 className="section-title">銀行口座 ({banks.length})</h2>
              <div className="flex gap-2">
                <a
                  href="/bank-accounts"
                  className="text-xs text-indigo-600 hover:text-indigo-800 font-medium px-2 py-1 rounded bg-indigo-50 hover:bg-indigo-100 transition-colors"
                >
                  銀行管理 →
                </a>
                <a
                  href="/dashboard?tab=simulation"
                  className="text-xs text-slate-500 hover:text-slate-700 font-medium px-2 py-1 rounded bg-slate-50 hover:bg-slate-100 transition-colors"
                >
                  残高シミュレーション →
                </a>
              </div>
            </div>
            <ItemList list={banks} />
          </div>
          <div className="card">
            <h2 className="section-title mb-1">クレジットカード ({cards.length})</h2>
            <ItemList list={cards} />
          </div>
        </div>
      </div>
    </>
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

const CATEGORY_LABEL: Record<string, string> = {
  REVENUE: "収入",
  COGS: "変動費",
  EXPENSE: "固定費・経費",
  PROFIT: "利益",
  ASSET: "資産",
  LIABILITY: "負債",
  OTHER: "その他",
};

function AccountNamesSection() {
  const [rows, setRows] = useState<AccountNameRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [dirty, setDirty] = useState<Record<number, { soleName: string; corporateName: string }>>(
    {},
  );

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

  const setField = (id: number, key: "soleName" | "corporateName", value: string) => {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, [key]: value } : r)));
    setDirty((d) => {
      const row = rows.find((r) => r.id === id)!;
      const base = d[id] ?? {
        soleName: row.soleName ?? "",
        corporateName: row.corporateName ?? "",
      };
      return { ...d, [id]: { ...base, [key]: value } };
    });
  };

  const save = async () => {
    const items = Object.entries(dirty).map(([id, v]) => ({
      id: Number(id),
      soleName: v.soleName,
      corporateName: v.corporateName,
    }));
    if (items.length === 0) {
      setMsg({ ok: false, text: "変更がありません。" });
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
      setMsg({ ok: true, text: `${items.length} 件の科目名を保存しました。` });
    } else {
      setMsg({ ok: false, text: "保存に失敗しました。" });
    }
  };

  const dirtyCount = Object.keys(dirty).length;

  return (
    <div className="card">
      <div className="flex items-start justify-between mb-2">
        <div>
          <h2 className="section-title">科目名設定（モード別表示名）</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            各勘定科目は家庭モードの科目名で登録されています。個人事業主モード・法人モードで表示する際の科目名をここで設定できます。
            空欄にすると家庭科目名がそのまま使われます。既定値は勘定科目変換マスタ（account-master-mapping.md）に基づきます。
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
                <th className="text-left py-2">法人モード表示名</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="py-1.5 pr-3 text-slate-400 tabular-nums whitespace-nowrap">
                    {r.code}
                  </td>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{r.name}</td>
                  <td className="py-1.5 pr-3 text-xs text-slate-500 whitespace-nowrap">
                    {CATEGORY_LABEL[r.category] ?? r.category}
                  </td>
                  <td className="py-1.5 pr-3">
                    <input
                      value={r.soleName ?? ""}
                      placeholder={r.name}
                      onChange={(e) => setField(r.id, "soleName", e.target.value)}
                      className="input-field w-full min-w-[12rem]"
                    />
                  </td>
                  <td className="py-1.5">
                    <input
                      value={r.corporateName ?? ""}
                      placeholder={r.name}
                      onChange={(e) => setField(r.id, "corporateName", e.target.value)}
                      className="input-field w-full min-w-[12rem]"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── 予算配分ルール設定 ───────────────────────────────────────────
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

function AllocationRulesSection() {
  const [rules, setRules] = useState<RuleEdit[]>([]);
  const [removedKeys, setRemovedKeys] = useState<string[]>([]);
  const [accounts, setAccounts] = useState<AccountRef[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
        key: "",
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
      setMsg({ ok: false, text: "項目名（key・ラベル）が未入力の行があります。" });
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
      <div className="flex items-start justify-between mb-2">
        <div>
          <h2 className="section-title">予算配分ルール</h2>
          <p className="text-xs text-slate-500 mt-1 max-w-2xl">
            収入配分の提案（予算管理の「配分提案」タブ）で使う推奨割合（%）です。対応科目を紐付けると、
            推奨額をその科目の予算へワンクリックで一括反映できます。
          </p>
        </div>
        <button
          onClick={save}
          disabled={saving}
          className="btn-primary px-4 py-2 whitespace-nowrap disabled:opacity-50"
        >
          {saving ? "保存中…" : "変更を保存"}
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
                <tr key={r.origKey ?? `new-${i}`}>
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
                      onClick={() => removeRule(i)}
                      className="text-xs text-slate-300 hover:text-red-500"
                    >
                      ✕
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

// ── メインページ ─────────────────────────────────────────────────
const TABS: { id: Tab; label: string }[] = [
  { id: "profile", label: "基本設定" },
  { id: "tax", label: "消費税設定" },
  { id: "accountNames", label: "科目名設定" },
  { id: "allocationRules", label: "予算配分ルール" },
  { id: "accounts", label: "口座・カード管理" },
  { id: "security", label: "セキュリティ" },
];

export default function SettingsPage() {
  const [tab, setTab] = useState<Tab>("profile");

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
      {tab === "allocationRules" && <AllocationRulesSection />}
      {tab === "security" && <SecuritySection />}
      {tab === "accounts" && <LinkedAccountsSection />}
    </AppShell>
  );
}
