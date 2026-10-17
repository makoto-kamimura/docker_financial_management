"use client";

// 口座・カードの登録・編集フォームの「明細ページの URL」欄。
// 空欄なら金融機関名から既定のサイト（lib/shared/statement-links.ts）を使うので、その URL を placeholder に出す。
import { presetStatementLink, type StatementLinkKind } from "@/lib/shared/statement-links";

export function StatementUrlField({
  kind,
  institution,
  value,
  onChange,
}: {
  kind: StatementLinkKind;
  /** 金融機関名・カード会社名（既定のサイトを探すのに使う） */
  institution: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const preset = presetStatementLink(kind, institution);
  return (
    <div>
      <label className="block text-sm font-medium text-slate-600 mb-1">明細ページの URL</label>
      <input
        type="url"
        inputMode="url"
        placeholder={preset?.url ?? "https://"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
      />
      <p className="mt-1 text-xs text-slate-500">
        {preset
          ? `空欄なら ${preset.siteName} を開きます（実績管理の CSV インポートから）。${preset.note ?? ""}`
          : "明細を見る・CSV を落とすサイトの URL です（任意）。実績管理の CSV インポートから開けます。"}
      </p>
    </div>
  );
}
