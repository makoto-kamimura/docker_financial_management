"use client";

import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";

// ── 型定義 ─────────────────────────────────────────────────────────────
type BusinessProfile = {
  id?: number;
  tradeName:     string;
  ownerName:     string;
  openedOn:      string;
  blueReturn:    boolean;
  invoiceNumber: string;
  taxationType:  string;
};

type TaxSetting = { taxYear: number; taxationType: string; simplifiedRate: string };

const TAX_TYPE_LABELS: Record<string, string> = {
  exempt:      "免税事業者",
  general:     "課税事業者（原則課税）",
  simplified:  "課税事業者（簡易課税）",
};

const PAYMENT_METHODS: Record<string, string> = {
  exempt:     "免税",
  general:    "原則課税",
  simplified: "簡易課税",
};

// ── 事業者情報セクション ────────────────────────────────────────────────
function BusinessProfileSection() {
  const [form, setForm] = useState<BusinessProfile>({
    tradeName: "", ownerName: "", openedOn: "", blueReturn: false,
    invoiceNumber: "", taxationType: "exempt",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/business-profile")
      .then(r => r.json())
      .then(({ data }) => {
        if (data) setForm({
          tradeName:     data.tradeName     ?? "",
          ownerName:     data.ownerName     ?? "",
          openedOn:      data.openedOn ? data.openedOn.slice(0, 10) : "",
          blueReturn:    data.blueReturn    ?? false,
          invoiceNumber: data.invoiceNumber ?? "",
          taxationType:  data.taxationType  ?? "exempt",
        });
      });
  }, []);

  async function save() {
    setSaving(true); setMsg(null);
    const res = await fetch("/api/business-profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...form, openedOn: form.openedOn || null }),
    });
    setMsg(res.ok ? { ok: true, text: "保存しました" } : { ok: false, text: "保存に失敗しました" });
    setSaving(false);
  }

  const f = (field: keyof BusinessProfile, val: string | boolean) =>
    setForm(prev => ({ ...prev, [field]: val }));

  return (
    <div className="card max-w-xl mb-6">
      <h2 className="section-title mb-4">事業者情報（F001）</h2>
      <div className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">屋号</span>
            <input className="input-field mt-1 w-full" value={form.tradeName}
              onChange={e => f("tradeName", e.target.value)} placeholder="○○商店" />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">氏名 *</span>
            <input className="input-field mt-1 w-full" value={form.ownerName}
              onChange={e => f("ownerName", e.target.value)} placeholder="山田 太郎" />
          </label>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">開業日</span>
            <input type="date" className="input-field mt-1 w-full" value={form.openedOn}
              onChange={e => f("openedOn", e.target.value)} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">消費税課税方式</span>
            <select className="input-field mt-1 w-full" value={form.taxationType}
              onChange={e => f("taxationType", e.target.value)}>
              {Object.entries(TAX_TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
        </div>
        <label className="block">
          <span className="text-xs font-medium text-slate-600">インボイス登録番号</span>
          <input className="input-field mt-1 w-full" value={form.invoiceNumber}
            onChange={e => f("invoiceNumber", e.target.value)} placeholder="T1234567890123" />
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input type="checkbox" checked={form.blueReturn}
            onChange={e => f("blueReturn", e.target.checked)}
            className="w-4 h-4 rounded text-indigo-600" />
          <span className="text-sm text-slate-700">青色申告（65万円控除）</span>
        </label>
      </div>
      <div className="mt-4 flex items-center gap-3">
        <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm px-4 py-1.5">
          {saving ? "保存中…" : "保存"}
        </button>
        {msg && (
          <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>
        )}
      </div>
    </div>
  );
}

// ── 消費税設定セクション ────────────────────────────────────────────────
function TaxSettingsSection() {
  const currentYear = new Date().getFullYear();
  const [settings, setSettings] = useState<TaxSetting[]>([]);
  const [form, setForm] = useState<TaxSetting>({
    taxYear: currentYear, taxationType: "exempt", simplifiedRate: "",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/tax-settings").then(r => r.json()).then(({ data }) => setSettings(data ?? []));
  }, []);

  async function save() {
    setSaving(true); setMsg(null);
    const res = await fetch("/api/tax-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taxYear:       form.taxYear,
        taxationType:  form.taxationType,
        simplifiedRate: form.simplifiedRate ? Number(form.simplifiedRate) : null,
      }),
    });
    if (res.ok) {
      const { data } = await res.json();
      setSettings(prev => {
        const idx = prev.findIndex(s => s.taxYear === data.taxYear);
        const next = [...prev];
        if (idx >= 0) next[idx] = data; else next.unshift(data);
        return next;
      });
      setMsg({ ok: true, text: "保存しました" });
    } else {
      setMsg({ ok: false, text: "保存に失敗しました" });
    }
    setSaving(false);
  }

  return (
    <div className="card max-w-xl mb-6">
      <h2 className="section-title mb-4">消費税設定（F012）</h2>
      <div className="space-y-3">
        <div className="grid grid-cols-3 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-slate-600">年度</span>
            <input type="number" className="input-field mt-1 w-full" value={form.taxYear}
              onChange={e => setForm(p => ({ ...p, taxYear: Number(e.target.value) }))} />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">課税方式</span>
            <select className="input-field mt-1 w-full" value={form.taxationType}
              onChange={e => setForm(p => ({ ...p, taxationType: e.target.value }))}>
              {Object.entries(PAYMENT_METHODS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-slate-600">みなし仕入率（%）</span>
            <input type="number" className="input-field mt-1 w-full" value={form.simplifiedRate}
              onChange={e => setForm(p => ({ ...p, simplifiedRate: e.target.value }))}
              placeholder="60" disabled={form.taxationType !== "simplified"} />
          </label>
        </div>
        <div className="flex items-center gap-3">
          <button type="button" onClick={save} disabled={saving} className="btn-primary text-sm px-4 py-1.5">
            {saving ? "保存中…" : "年度設定を保存"}
          </button>
          {msg && <p className={`text-sm ${msg.ok ? "text-green-600" : "text-red-600"}`}>{msg.text}</p>}
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
            {settings.map(s => (
              <tr key={s.taxYear} className="hover:bg-slate-50">
                <td className="py-1.5 font-medium">{s.taxYear}年</td>
                <td className="py-1.5 text-slate-600">{PAYMENT_METHODS[s.taxationType] ?? s.taxationType}</td>
                <td className="py-1.5 text-slate-600">{s.simplifiedRate ? `${s.simplifiedRate}%` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── MFA リカバリーコードセクション ─────────────────────────────────────
function MfaRecoverySection() {
  const [totpCode,       setTotpCode]       = useState("");
  const [recoveryCodes,  setRecoveryCodes]  = useState<string[] | null>(null);
  const [generating,     setGenerating]     = useState(false);
  const [msg,            setMsg]            = useState<{ ok: boolean; text: string } | null>(null);

  async function generate() {
    if (!confirm("既存のリカバリーコードはすべて無効になります。よろしいですか？")) return;
    setGenerating(true); setMsg(null); setRecoveryCodes(null);
    const res = await fetch("/api/auth/mfa/recovery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ totp: totpCode }),
    });
    const json = await res.json();
    if (res.ok) {
      setRecoveryCodes(json.codes);
      setMsg({ ok: true, text: json.message });
    } else {
      setMsg({ ok: false, text: json.error ?? "生成に失敗しました" });
    }
    setGenerating(false);
    setTotpCode("");
  }

  return (
    <div className="card max-w-lg mb-6">
      <h2 className="section-title">MFA リカバリーコード</h2>
      <p className="text-sm text-slate-500 mb-4">
        MFA 認証デバイスを紛失した場合に使用できる使い捨てコードです。MFA 有効化後に発行できます。
      </p>
      <div className="flex gap-2 mb-4">
        <input placeholder="現在の TOTP コード（6桁）" value={totpCode}
          onChange={e => setTotpCode(e.target.value)} maxLength={6}
          className="input-field w-40 text-center tracking-widest font-mono" />
        <button type="button" onClick={generate} disabled={generating || totpCode.length !== 6}
          className="btn-primary text-sm px-3 py-1.5 disabled:opacity-50">
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
              <code key={i} className="bg-white border border-amber-200 rounded px-2 py-1 text-xs font-mono text-slate-800">
                {c}
              </code>
            ))}
          </div>
        </div>
      )}
      {msg && (
        <p className={`text-sm rounded-lg px-3 py-2 border ${
          msg.ok ? "text-green-700 bg-green-50 border-green-200" : "text-red-600 bg-red-50 border-red-200"
        }`}>{msg.text}</p>
      )}
    </div>
  );
}

// ── MFA セクション ──────────────────────────────────────────────────────
function MfaSection() {
  const [secret, setSecret] = useState<string | null>(null);
  const [uri,    setUri]    = useState<string | null>(null);
  const [code,   setCode]   = useState("");
  const [msg,    setMsg]    = useState<{ ok: boolean; text: string } | null>(null);

  async function setup() {
    setMsg(null);
    const res = await fetch("/api/auth/mfa/setup", { method: "POST" });
    if (!res.ok) return setMsg({ ok: false, text: "セットアップに失敗しました。" });
    const json = await res.json();
    setSecret(json.secret); setUri(json.otpauthUri);
  }

  async function enable() {
    const res = await fetch("/api/auth/mfa/enable", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    setMsg(res.ok
      ? { ok: true,  text: "MFA を有効化しました。" }
      : { ok: false, text: "コードが正しくありません。" });
  }

  return (
    <div className="card max-w-lg">
      <h2 className="section-title">多要素認証（MFA / TOTP）</h2>
      <ol className="space-y-1 text-sm text-slate-600 mb-6 list-decimal list-inside">
        <li>「シークレット発行」を押す</li>
        <li>表示されたシークレットを認証アプリに登録</li>
        <li>アプリに表示された 6 桁コードを入力して有効化</li>
      </ol>
      <button type="button" onClick={setup} className="btn-primary">シークレット発行</button>
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
            <input placeholder="6 桁コード" value={code} onChange={e => setCode(e.target.value)}
              maxLength={6} className="input-field w-36 text-center tracking-widest font-mono" />
            <button type="button" onClick={enable} className="btn-primary">有効化</button>
          </div>
        </div>
      )}
      {msg && (
        <p className={`mt-4 text-sm rounded-lg px-3 py-2 border ${
          msg.ok ? "text-green-700 bg-green-50 border-green-200" : "text-red-600 bg-red-50 border-red-200"
        }`}>{msg.text}</p>
      )}
    </div>
  );
}

// ── メインページ ────────────────────────────────────────────────────────
export default function SettingsPage() {
  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">設定</h1>
        <p className="text-sm text-slate-500 mt-0.5">事業者情報・消費税・セキュリティの管理</p>
      </div>
      <BusinessProfileSection />
      <TaxSettingsSection />
      <MfaSection />
      <MfaRecoverySection />
    </AppShell>
  );
}
