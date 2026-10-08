"use client";

// 設定の「消費税設定」タブ。

import { useEffect, useState } from "react";
import { SETTINGS_HELP } from "@/lib/shared/help-texts";
import { SaveNotice, SectionCard, type SaveMessage } from "@/components/SectionCard";

type TaxSetting = { taxYear: number; taxationType: string; simplifiedRate: string };

const PAYMENT_METHODS: Record<string, string> = {
  exempt: "免税",
  general: "原則課税",
  simplified: "簡易課税",
};

// ── 消費税設定セクション ─────────────────────────────────────────
export function TaxSettingsSection() {
  const currentYear = new Date().getFullYear();
  const [settings, setSettings] = useState<TaxSetting[]>([]);
  const [form, setForm] = useState<TaxSetting>({
    taxYear: currentYear,
    taxationType: "exempt",
    simplifiedRate: "",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<SaveMessage>(null);

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
    <SectionCard
      title="消費税設定"
      lead={SETTINGS_HELP.tax}
      actions={
        <button type="button" onClick={save} disabled={saving} className="btn-primary">
          {saving ? "保存中…" : "年度設定を保存"}
        </button>
      }
    >
      <div className="space-y-3 max-w-2xl">
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
      </div>
      <SaveNotice msg={msg} />
      {settings.length > 0 && (
        <table className="mt-4 w-full max-w-2xl text-sm">
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
    </SectionCard>
  );
}
