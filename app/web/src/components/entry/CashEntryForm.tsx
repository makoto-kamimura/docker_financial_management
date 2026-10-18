"use client";

// 現金の明細を 1 件登録するフォーム（実績管理のカレンダーと取り込みで使う）。支払元・入金先は現金に固定する。
// 読み取ったレシート（receipt）を渡すと、店名・合計・科目の候補・事業利用・セルフメディケーションを入れておき、
// 登録した明細にレシートの写真を証憑として付ける。別のレシートにするときは、親が key を変えて作り直す。
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { invalidateActuals } from "@/lib/client/invalidate-actuals";
import { selfMedicationOf } from "@/lib/shared/self-medication";
import { BUSINESS_USE_LABEL, isValidBusinessRatio } from "@/lib/shared/business-use";
import type { ViewMode } from "@/lib/shared/display-name";
import type { PaymentMethod } from "@/lib/ledger/receipt-scan/types";
import type { ScannedReceipt } from "@/components/entry/ReceiptScanButton";
import { EXPENSE_CATS, INCOME_CATS, type Account, type CashEntry } from "@/components/entry/types";

const BLANK_FORM = {
  description: "",
  accountCode: "",
  amount: "",
  direction: "expense" as "income" | "expense",
};

const PAYMENT_WARNINGS: Partial<Record<PaymentMethod, string>> = {
  card: "カード払いのレシートのようです。カードの明細から入る分と二重に計上しないよう注意してください。",
  emoney:
    "電子マネーや QR コード決済のレシートのようです。電子マネーの明細から入る分と二重に計上しないよう注意してください。",
};

type SelfMedication = { on: boolean; amount: string; items: { name: string; amount: number }[] };

export function CashEntryForm({
  accounts,
  mode,
  date,
  onDateChange,
  receipt = null,
  onSaved,
  onSkip,
}: {
  accounts: Account[] | undefined;
  mode: ViewMode;
  /** 登録する日（YYYY-MM-DD） */
  date: string;
  /** 渡すと日付の欄を出す（取り込み。カレンダーは選んだ日で登録する） */
  onDateChange?: (date: string) => void;
  /** 読み取ったレシート */
  receipt?: ScannedReceipt | null;
  /** 登録できたとき。photoSaved は証憑の写真を保存できたか（レシートが無ければ true） */
  onSaved?: (entry: CashEntry, photoSaved: boolean) => void;
  /** 渡すと「この 1 枚を飛ばす」を出す（取り込みで、複数枚を順に登録するとき） */
  onSkip?: () => void;
}) {
  const queryClient = useQueryClient();
  const incomeAccounts = (accounts ?? []).filter((a) => INCOME_CATS.includes(a.category));
  const expenseAccounts = (accounts ?? []).filter((a) => EXPENSE_CATS.includes(a.category));
  const suggested = receipt?.result.suggestedAccount ?? null;
  const draft = receipt?.result.draft ?? null;

  const [form, setForm] = useState(() =>
    draft
      ? {
          direction: "expense" as const,
          description: draft.merchant ?? "",
          amount: draft.total ? String(draft.total) : "",
          accountCode:
            suggested && (!accounts || expenseAccounts.some((a) => a.code === suggested.code))
              ? suggested.code
              : "",
        }
      : BLANK_FORM,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // レシートから入れたときだけ「店名と科目を覚える」を出す
  const [learn, setLearn] = useState(true);
  // セルフメディケーション税制の対象の市販薬を含むレシート。証憑に対象の額と品目を残す（控除・確定申告で使う）
  const [selfMed, setSelfMed] = useState<SelfMedication | null>(() => {
    if (!draft) return null;
    const sm = selfMedicationOf(draft);
    return { on: sm !== null, amount: sm ? String(sm.amount) : "", items: sm?.items ?? [] };
  });
  // 個人事業主モードは事業利用で始める（按分を空けると、科目の事業利用按分の割合、無ければ 100%）。
  // 学習ルールが事業利用を決めていれば、その事業利用にする
  const businessMode = mode === "sole";
  const [business, setBusiness] = useState(suggested?.business?.businessUse ?? true);
  const [ratio, setRatio] = useState(suggested?.business?.businessRatio?.toString() ?? "");

  const mainAccounts = form.direction === "income" ? incomeAccounts : expenseAccounts;
  const warning = draft ? (PAYMENT_WARNINGS[draft.paymentMethod] ?? null) : null;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const r = ratio.trim() === "" ? null : Number(ratio);
    if (businessMode && business && r !== null && !isValidBusinessRatio(r)) {
      setError("按分は 0 より大きく 100 以下で入れてください");
      return;
    }
    setSaving(true);
    setError("");
    const res = await fetch("/api/actuals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        date,
        description: form.description,
        accountCode: form.accountCode,
        amount: Number(form.amount),
        direction: form.direction,
        learn: receipt !== null && learn,
        ...(businessMode ? { businessUse: business, businessRatio: business ? r : null } : {}),
      }),
    });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "登録に失敗しました");
      setSaving(false);
      return;
    }
    const { data } = (await res.json()) as { data: CashEntry };
    let photoSaved = true;
    if (receipt) {
      const body = new FormData();
      body.append("file", receipt.photo);
      if (selfMed?.on && /^\d+$/.test(selfMed.amount)) {
        body.append("selfMedicationAmount", selfMed.amount);
        body.append("selfMedicationItems", JSON.stringify(selfMed.items));
      }
      const up = await fetch(`/api/actuals/${data.id}/receipts`, { method: "POST", body });
      photoSaved = up.ok;
      if (!up.ok) setError("実績は登録しましたが、レシートの写真を保存できませんでした");
    }
    setForm(BLANK_FORM);
    setSelfMed(null);
    setSaving(false);
    invalidateActuals(queryClient);
    onSaved?.(data, photoSaved);
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-2.5">
      {warning && <p className="text-[10px] text-amber-700">{warning}</p>}
      <div className="flex rounded-lg overflow-hidden border border-slate-200 text-xs">
        {(["expense", "income"] as const).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setForm((f) => ({ ...f, direction: d, accountCode: "" }))}
            className={`flex-1 py-1.5 font-medium transition-colors ${
              form.direction === d
                ? d === "expense"
                  ? "bg-rose-500 text-white"
                  : "bg-emerald-500 text-white"
                : "bg-white text-slate-500 hover:bg-slate-50"
            }`}
          >
            {d === "expense" ? "支出" : "収入"}
          </button>
        ))}
      </div>
      {onDateChange && (
        <div className="flex flex-col gap-1">
          <label className="text-[10px] text-slate-500">日付</label>
          <input
            type="date"
            required
            value={date}
            onChange={(e) => onDateChange(e.target.value)}
            className="input-field text-xs"
          />
        </div>
      )}
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-slate-500">摘要</label>
        <input
          type="text"
          required
          placeholder="例: 食料品"
          value={form.description}
          onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
          className="input-field text-xs"
        />
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-slate-500">
          {form.direction === "expense" ? "支出科目" : "収入科目"}
        </label>
        <select
          required
          value={form.accountCode}
          onChange={(e) => setForm((f) => ({ ...f, accountCode: e.target.value }))}
          className="input-field text-xs"
        >
          <option value="">選択してください</option>
          {mainAccounts.map((a) => (
            <option key={a.code} value={a.code}>
              {a.code} {a.name}
            </option>
          ))}
        </select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-[10px] text-slate-500">金額（円）</label>
        <input
          type="number"
          required
          min={1}
          placeholder="例: 5000"
          value={form.amount}
          onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
          className="input-field text-xs"
        />
      </div>
      {businessMode && (
        <div className="flex items-center gap-1.5 text-[10px] text-slate-600">
          <label className="inline-flex items-center gap-1">
            <input
              type="checkbox"
              checked={business}
              onChange={(e) => setBusiness(e.target.checked)}
            />
            {BUSINESS_USE_LABEL}
          </label>
          {business && (
            <>
              <span>按分</span>
              <input
                type="number"
                min={0.01}
                max={100}
                step={0.01}
                value={ratio}
                placeholder="既定"
                onChange={(e) => setRatio(e.target.value)}
                aria-label="按分（%）"
                className="input-field text-xs w-20"
              />
              <span>%</span>
            </>
          )}
        </div>
      )}
      {receipt && form.description.trim() !== "" && (
        <label className="flex items-start gap-1.5 text-[10px] text-slate-600">
          <input
            type="checkbox"
            checked={learn}
            onChange={(e) => setLearn(e.target.checked)}
            className="mt-0.5"
          />
          次から同じ店名には、この科目を使う（学習ルールに覚える）
        </label>
      )}
      {receipt && selfMed && (
        <div className="space-y-1 rounded border border-slate-200 p-2 text-[10px] text-slate-600">
          <label className="flex items-start gap-1.5">
            <input
              type="checkbox"
              checked={selfMed.on}
              onChange={(e) => setSelfMed({ ...selfMed, on: e.target.checked })}
              className="mt-0.5"
            />
            セルフメディケーション税制の対象の市販薬を含む（レシートを控除・確定申告で使う）
          </label>
          {selfMed.on && (
            <>
              <div className="flex items-center gap-1.5">
                <span>対象の額</span>
                <input
                  type="number"
                  min={0}
                  value={selfMed.amount}
                  onChange={(e) => setSelfMed({ ...selfMed, amount: e.target.value })}
                  aria-label="セルフメディケーションの対象の額"
                  className="input-field w-24 text-right text-xs"
                />
                <span>円</span>
              </div>
              {selfMed.items.length > 0 && (
                <p>対象の品目: {selfMed.items.map((i) => i.name).join("、")}</p>
              )}
            </>
          )}
        </div>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex gap-2 mt-1">
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            disabled={saving}
            className="btn-secondary text-xs flex-1"
          >
            この 1 枚を飛ばす
          </button>
        )}
        <button type="submit" disabled={saving} className="btn-primary text-xs flex-1">
          {saving ? "登録中..." : "登録"}
        </button>
      </div>
    </form>
  );
}
