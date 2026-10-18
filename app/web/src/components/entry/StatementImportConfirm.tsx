"use client";

// 実績管理の取り込み（銀行・カード）の「取り込む前の確認」。取り込み先・明細の読み方・先頭の行・飛ばす行を見せる。
import { Modal } from "@/components/Modal";
import { Notice } from "@/components/ui";
import { yen } from "@/lib/common/format";
import { AMOUNT_STYLE_LABEL, type StatementConversion } from "@/lib/shared/statement-formats";

/** 確認に出す、変換した明細の行数 */
const PREVIEW_ROWS = 5;

export function StatementImportConfirm({
  fileName,
  label,
  conversion,
  warning,
  onCancel,
  onConfirm,
}: {
  fileName: string;
  /** 取り込み先（例: 銀行: 住信SBI普通） */
  label: string;
  conversion: StatementConversion;
  /** 明細の形と取り込み先が食い違って見えるときの注意 */
  warning: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Modal size="md">
      <h2 className="text-lg font-bold text-slate-800 mb-4">取り込む前の確認</h2>
      <dl className="text-sm border border-slate-200 rounded-lg divide-y divide-slate-100 mb-4">
        <div className="flex gap-3 px-3 py-2">
          <dt className="w-20 shrink-0 text-slate-500">ファイル</dt>
          <dd className="text-slate-700 break-all">{fileName}</dd>
        </div>
        <div className="flex gap-3 px-3 py-2 bg-amber-50">
          <dt className="w-20 shrink-0 text-slate-500">取り込み先</dt>
          <dd className="font-semibold text-slate-800">{label}</dd>
        </div>
        <div className="flex gap-3 px-3 py-2">
          <dt className="w-20 shrink-0 text-slate-500">読み方</dt>
          <dd className="text-slate-700 space-y-0.5">
            <p>
              {conversion.headerless
                ? "見出しの無いカード明細（日付・摘要・利用金額の並び）"
                : AMOUNT_STYLE_LABEL[conversion.style]}
            </p>
            <p className="text-xs text-slate-500">
              {conversion.columns.map((c) => `${c.role}=${c.names.join("＋")}`).join("、")}
            </p>
          </dd>
        </div>
      </dl>
      {warning && (
        <Notice tone="warn" className="mb-4">
          {warning}
        </Notice>
      )}
      <ConversionPreview conversion={conversion} />
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
        >
          キャンセル
        </button>
        <button
          type="button"
          onClick={onConfirm}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
        >
          取り込む
        </button>
      </div>
    </Modal>
  );
}

/** 変換した明細の先頭の行と、飛ばした行 */
function ConversionPreview({ conversion }: { conversion: StatementConversion }) {
  const { rows, skipped } = conversion;
  return (
    <div className="mb-4 space-y-2">
      <p className="text-xs text-slate-500">
        {rows.length.toLocaleString()} 件を取り込みます
        {skipped.length > 0 &&
          `（日付・金額の無い ${skipped.length.toLocaleString()} 行は飛ばします）`}
        。先頭の {Math.min(rows.length, PREVIEW_ROWS)} 件:
      </p>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-2 py-1 text-left font-medium">日付</th>
              <th className="px-2 py-1 text-left font-medium">摘要</th>
              <th className="px-2 py-1 text-right font-medium">金額</th>
              <th className="px-2 py-1 text-right font-medium">残高</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.slice(0, PREVIEW_ROWS).map((r, i) => (
              <tr key={i} className="text-slate-700">
                <td className="px-2 py-1 whitespace-nowrap tabular-nums">{r.date}</td>
                <td className="px-2 py-1 break-all">{r.description}</td>
                <td
                  className={`px-2 py-1 text-right whitespace-nowrap tabular-nums ${r.amount < 0 ? "text-red-600" : "text-emerald-700"}`}
                >
                  {yen(r.amount)}
                </td>
                <td className="px-2 py-1 text-right whitespace-nowrap tabular-nums text-slate-500">
                  {r.balance === undefined ? "—" : yen(r.balance)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {skipped.length > 0 && (
        <details className="text-xs text-slate-500">
          <summary className="cursor-pointer">飛ばす行</summary>
          <ul className="mt-1 space-y-0.5 font-mono">
            {skipped.slice(0, PREVIEW_ROWS).map((r, i) => (
              <li key={i} className="truncate">
                {r.reason}: {r.text}
              </li>
            ))}
            {skipped.length > PREVIEW_ROWS && <li>ほか {skipped.length - PREVIEW_ROWS} 行</li>}
          </ul>
        </details>
      )}
    </div>
  );
}
