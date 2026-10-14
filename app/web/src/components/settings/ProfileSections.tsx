"use client";

// 設定の「基本設定」タブ（表示名・会計期間・事業者情報）。

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SETTINGS_HELP } from "@/lib/shared/help-texts";
import { fiscalMonthsError, isValidFiscalMonths } from "@/lib/accounting/fiscal-months";
import { SaveNotice, SectionCard, type SaveMessage } from "@/components/SectionCard";

type BusinessProfile = {
  id?: number;
  tradeName: string;
  ownerName: string;
  openedOn: string;
  blueReturn: boolean;
  invoiceNumber: string;
  taxationType: string;
};

const TAX_TYPE_LABELS: Record<string, string> = {
  exempt: "免税事業者",
  general: "課税事業者（原則課税）",
  simplified: "課税事業者（簡易課税）",
};

// ── 表示名セクション ─────────────────────────────────────────────
// 自分の表示名（画面の右上・ユーザー管理・監査ログに出る）。PATCH /api/auth/me。
export function DisplayNameSection() {
  const qc = useQueryClient();
  const { data: me } = useQuery({
    queryKey: ["auth-me"],
    queryFn: async (): Promise<{ name: string; email: string } | null> => {
      const res = await fetch("/api/auth/me");
      if (!res.ok) return null;
      return (await res.json()).user ?? null;
    },
  });
  const [name, setName] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<SaveMessage>(null);
  const value = name ?? me?.name ?? "";

  async function save() {
    setSaving(true);
    setMsg(null);
    const res = await fetch("/api/auth/me", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: value }),
    });
    setSaving(false);
    if (res.ok) {
      setMsg({ ok: true, text: "表示名を変更しました" });
      setName(null);
      qc.invalidateQueries({ queryKey: ["auth-me"] });
      qc.invalidateQueries({ queryKey: ["admin-users"] });
    } else {
      setMsg({ ok: false, text: "変更に失敗しました（1〜50 文字で入力してください）" });
    }
  }

  return (
    <SectionCard
      title="あなたの表示名"
      lead={SETTINGS_HELP.displayName}
      actions={
        <button
          type="button"
          onClick={save}
          disabled={saving || !me || value.trim() === "" || value === me.name}
          className="btn-primary"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      }
    >
      <div className="flex flex-wrap items-end gap-3">
        <label className="block">
          <span className="text-xs font-medium text-slate-600">表示名</span>
          <input
            className="input-field mt-1 w-64"
            value={value}
            maxLength={50}
            onChange={(e) => setName(e.target.value)}
            disabled={!me}
          />
        </label>
        {me && <span className="text-xs text-slate-400 pb-2">ログイン: {me.email}</span>}
      </div>
      <SaveNotice msg={msg} />
    </SectionCard>
  );
}

// ── 会計期間セクション ───────────────────────────────────────────
// 期の開始月と決算月（tenants.startMonth / closingMonth）。ダッシュボードの累計と年間見込みはこの期で集計し、
// 予算の確定では開始月だけ前月の実績の確定を待たない。開始月は決算月の翌月でなければ保存できない
// （API と DB の CHECK 制約でも検査する）。法人ページと同じ値で、どのモードからも変えられるようにここにも置く。
const MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);

function MonthSelect({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: number;
  onChange: (month: number) => void;
  disabled: boolean;
}) {
  return (
    <label className="flex items-center gap-2">
      <span className="text-xs font-medium text-slate-600">{label}</span>
      <select
        className="input-field w-28"
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
      >
        {MONTHS.map((m) => (
          <option key={m} value={m}>
            {m}月
          </option>
        ))}
      </select>
    </label>
  );
}

export function FiscalPeriodSection() {
  const qc = useQueryClient();
  const [tenantId, setTenantId] = useState<number | null>(null);
  const [startMonth, setStartMonth] = useState(1);
  const [closingMonth, setClosingMonth] = useState(12);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<SaveMessage>(null);

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => r.json())
      .then(async ({ user }) => {
        if (!user) return;
        setTenantId(user.tenantId);
        const res = await fetch(`/api/tenants/${user.tenantId}`);
        const { data } = await res.json();
        if (data?.closingMonth) setClosingMonth(data.closingMonth);
        if (data?.startMonth) setStartMonth(data.startMonth);
      })
      .catch(() => {});
  }, []);

  const valid = isValidFiscalMonths(startMonth, closingMonth);

  async function save() {
    if (tenantId === null || !valid) return;
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`/api/tenants/${tenantId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ startMonth, closingMonth }),
      });
      if (res.ok) {
        setMsg({ ok: true, text: "保存しました" });
        qc.invalidateQueries({ queryKey: ["kpi"] });
        qc.invalidateQueries({ queryKey: ["cycle-status"] });
      } else if (res.status === 403) {
        setMsg({ ok: false, text: "変更できるのは編集者以上のユーザーです" });
      } else {
        const err = await res.json().catch(() => ({}));
        setMsg({
          ok: false,
          text: typeof err.error === "string" ? err.error : "保存に失敗しました",
        });
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="会計期間"
      lead={SETTINGS_HELP.fiscalPeriod}
      actions={
        <button
          type="button"
          onClick={save}
          disabled={saving || tenantId === null || !valid}
          className="btn-primary"
        >
          {saving ? "保存中…" : "保存"}
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <MonthSelect
          label="開始月"
          value={startMonth}
          onChange={setStartMonth}
          disabled={tenantId === null}
        />
        <MonthSelect
          label="決算月"
          value={closingMonth}
          onChange={setClosingMonth}
          disabled={tenantId === null}
        />
        {valid && (
          <span className="text-xs text-slate-500">
            1年は {startMonth}月〜{closingMonth}月
          </span>
        )}
      </div>
      {!valid && <p className="text-xs text-red-600 mt-2">{fiscalMonthsError(closingMonth)}</p>}
      <SaveNotice msg={msg} />
    </SectionCard>
  );
}

// ── 事業者情報セクション ─────────────────────────────────────────
export function BusinessProfileSection() {
  const [form, setForm] = useState<BusinessProfile>({
    tradeName: "",
    ownerName: "",
    openedOn: "",
    blueReturn: false,
    invoiceNumber: "",
    taxationType: "exempt",
  });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<SaveMessage>(null);

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
    <SectionCard
      title="事業者情報"
      lead={SETTINGS_HELP.businessProfile}
      actions={
        <button type="button" onClick={save} disabled={saving} className="btn-primary">
          {saving ? "保存中…" : "保存"}
        </button>
      }
    >
      <div className="space-y-3 max-w-2xl">
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
              「税制設定」タブの消費税設定で対象年度の設定があれば、そちらが優先されます。
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
      <SaveNotice msg={msg} />
    </SectionCard>
  );
}
