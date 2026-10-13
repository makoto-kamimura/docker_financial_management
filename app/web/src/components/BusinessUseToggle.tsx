"use client";

// 口座・カード・電子マネー・実物資産・借入金の「事業利用」の切り替え（登録・編集の画面）。
// 事業利用のものは、個人事業主モードで表示・集計される（家庭・法人モードでは全件を出す）。
// 口座・カードでは、入ってくる明細も事業利用で入る（lib/ledger/ledger-entries.ts）。

import { BUSINESS_USE_LABEL } from "@/lib/shared/business-use";

const HINTS = {
  account:
    "事業で使う口座・カードです。個人事業主モードで表示・集計し、取り込んだ明細も事業利用で入ります。",
  asset: "事業で使う資産です。個人事業主モードで表示・集計します。",
  loan: "事業のための借入です。個人事業主モードで表示・集計します。",
} as const;

export function BusinessUseToggle({
  checked,
  onChange,
  kind,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  kind: keyof typeof HINTS;
}) {
  return (
    <label className="flex items-start gap-2 text-sm text-slate-700">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1"
      />
      <span>
        {BUSINESS_USE_LABEL}
        <span className="block text-xs text-slate-500">{HINTS[kind]}</span>
      </span>
    </label>
  );
}
