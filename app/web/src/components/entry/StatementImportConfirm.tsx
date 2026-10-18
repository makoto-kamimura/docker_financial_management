"use client";

// 実績管理の取り込み（銀行・カード）の「取り込む前の確認」。取り込み先・明細の読み方・先頭の行・飛ばす行と、
// 試し取り込み（POST /api/imports?dryRun=1）の結果（件数・取り込み済みかもしれない明細・銀行の残高の照合）を見せる。
import Link from "next/link";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { Notice } from "@/components/ui";
import { yen } from "@/lib/common/format";
import { AMOUNT_STYLE_LABEL, type StatementConversion } from "@/lib/shared/statement-formats";

/** 確認に出す、変換した明細の行数 */
const PREVIEW_ROWS = 5;

/** 試し取り込みの結果（POST /api/imports?dryRun=1 の preview） */
export type ImportPreview = {
  from: string | null;
  to: string | null;
  /** 新しく入る件数・取り込み済み・確定済みの月 */
  fresh: number;
  duplicate: number;
  locked: number;
  /** 同じ口座に、同じ日付・同じ金額で摘要の違う明細がある行（index は明細の位置） */
  possibleDuplicates: {
    index: number;
    date: string;
    description: string;
    amount: number;
    existing: string[];
  }[];
  /** 銀行で残高の列があるときの照合 */
  balanceCheck: {
    gaps: { index: number; date: string; expected: number; actual: number }[];
    opening: {
      date: string;
      csv: number;
      app: number;
      diff: number;
      adjustment: number;
      hasEarlier: boolean;
    };
  } | null;
};

export function StatementImportConfirm({
  fileName,
  label,
  conversion,
  warning,
  preview,
  mappingSource,
  onEditMapping,
  remember,
  onRememberChange,
  onCancel,
  onConfirm,
}: {
  fileName: string;
  /** 取り込み先（例: 銀行: 住信SBI普通） */
  label: string;
  conversion: StatementConversion;
  /** 明細の形と取り込み先が食い違って見えるときの注意 */
  warning: string | null;
  /** 試し取り込みの結果。読み込み中は "loading"、失敗したら "failed" */
  preview: ImportPreview | "loading" | "failed";
  onCancel: () => void;
  /** excluded は取り込まない明細の位置（取り込み済みかもしれない明細のうち、取り込むと選ばなかったもの） */
  onConfirm: (excluded: Set<number>) => void;
  /** 読み方の出どころ: 口座に覚えた読み方（saved）・この画面で選んだ読み方（edited）・自動（auto） */
  mappingSource: "saved" | "edited" | "auto";
  /** 「読み方を変える」 */
  onEditMapping: () => void;
  /** 選んだ読み方を口座に覚えるか（mappingSource が edited のときだけ出す） */
  remember: boolean;
  onRememberChange: (remember: boolean) => void;
}) {
  // 取り込み済みかもしれない明細は、既定では取り込まない（同じ支出の二重計上を防ぐ）。取り込むと選んだものの位置
  const [included, setIncluded] = useState<Set<number>>(new Set());
  const loaded = typeof preview === "object" ? preview : null;
  const excluded = new Set(
    (loaded?.possibleDuplicates ?? []).map((p) => p.index).filter((i) => !included.has(i)),
  );
  const freshCount = loaded ? loaded.fresh - excluded.size : null;

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
            <p className="flex flex-wrap items-center gap-2 text-xs">
              {mappingSource === "saved" && (
                <span className="text-slate-500">この口座に覚えた読み方で読みました。</span>
              )}
              <button
                type="button"
                onClick={onEditMapping}
                className="text-indigo-600 hover:underline"
              >
                読み方を変える
              </button>
            </p>
            {mappingSource === "edited" && (
              <label className="flex items-start gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={remember}
                  onChange={(e) => onRememberChange(e.target.checked)}
                />
                この読み方を口座に覚える（次から同じ見出しの CSV に使います）
              </label>
            )}
          </dd>
        </div>
      </dl>
      {warning && (
        <Notice tone="warn" className="mb-4">
          {warning}
        </Notice>
      )}
      <PlanSummary preview={preview} freshCount={freshCount} />
      {loaded && loaded.possibleDuplicates.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-slate-700">
          <p className="font-medium mb-1">取り込み済みかもしれない明細</p>
          <p className="text-slate-500 mb-2">
            同じ日・同じ金額で、摘要の違う明細がすでにあります（カードの確定前と確定後で摘要が変わったときなど）。
            別の明細なら、チェックを入れて取り込んでください。
          </p>
          <ul className="space-y-1">
            {loaded.possibleDuplicates.map((p) => (
              <li key={p.index}>
                <label className="flex items-start gap-2">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={included.has(p.index)}
                    onChange={(e) => {
                      const next = new Set(included);
                      if (e.target.checked) next.add(p.index);
                      else next.delete(p.index);
                      setIncluded(next);
                    }}
                  />
                  <span>
                    <span className="tabular-nums">{p.date}</span> {p.description}{" "}
                    <span className="tabular-nums">{yen(p.amount)}</span>
                    <span className="block text-slate-500">
                      すでにある明細: {p.existing.join("、")}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </div>
      )}
      {loaded?.balanceCheck && <BalanceCheckNote check={loaded.balanceCheck} />}
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
          onClick={() => onConfirm(excluded)}
          disabled={preview === "loading" || freshCount === 0}
          className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg disabled:opacity-50 disabled:cursor-not-allowed"
        >
          取り込む
        </button>
      </div>
    </Modal>
  );
}

/** 変換した明細の先頭の行と、飛ばした行（読み方を選ぶ画面でも使う） */
export function ConversionPreview({ conversion }: { conversion: StatementConversion }) {
  const { rows, skipped } = conversion;
  return (
    <div className="mb-4 space-y-2">
      <p className="text-xs text-slate-500">
        CSV の明細 {rows.length.toLocaleString()} 件
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

/** 期間と、新しく入る件数・取り込み済み・確定済みの月 */
function PlanSummary({
  preview,
  freshCount,
}: {
  preview: ImportPreview | "loading" | "failed";
  freshCount: number | null;
}) {
  if (preview === "loading") {
    return <p className="mb-4 text-xs text-slate-500">取り込み済みの明細と照らし合わせています…</p>;
  }
  if (preview === "failed") {
    return (
      <p className="mb-4 text-xs text-slate-500">
        取り込み済みの明細と照らし合わせられませんでした。取り込むと、同じ明細は重ねて登録されません。
      </p>
    );
  }
  return (
    <div className="mb-4 rounded-lg border border-slate-200 px-3 py-2 text-sm">
      {preview.from && (
        <p className="text-xs text-slate-500">
          期間 {preview.from} 〜 {preview.to}
        </p>
      )}
      <p className="text-slate-800">
        新しく入る <span className="font-semibold">{freshCount!.toLocaleString()}</span> 件
        <span className="text-slate-500">
          {" "}
          / 取り込み済み {preview.duplicate.toLocaleString()} 件
          {preview.locked > 0 && ` / 実績を確定済みの月 ${preview.locked.toLocaleString()} 件`}
        </span>
      </p>
      {freshCount === 0 && (
        <p className="mt-1 text-xs text-slate-500">新しく取り込む明細はありません。</p>
      )}
    </div>
  );
}

/** 銀行の残高の照合（行のつながりと、始まりの残高。取り込みは止めない） */
function BalanceCheckNote({ check }: { check: NonNullable<ImportPreview["balanceCheck"]> }) {
  const { gaps, opening } = check;
  if (gaps.length === 0 && opening.diff === 0) {
    return (
      <p className="mb-4 text-xs text-emerald-700">
        CSV の残高は、アプリの残高とつながっています。
      </p>
    );
  }
  return (
    <Notice tone="warn" className="mb-4">
      {gaps.length > 0 && (
        <span className="block">
          残高がつながらない行があります（{gaps.map((g) => g.date).join("、")}
          ）。間の明細が欠けているかもしれません。
        </span>
      )}
      {opening.diff !== 0 &&
        (opening.hasEarlier ? (
          <span className="block">
            CSV の始まり（{opening.date} の前）の残高は {yen(opening.csv)} で、アプリの残高{" "}
            {yen(opening.app)} より {yen(Math.abs(opening.diff))}{" "}
            {opening.diff > 0 ? "多い" : "少ない"}
            です。これより前の明細が足りないか、差額（期首残高）が合っていません。
          </span>
        ) : (
          <span className="block">
            CSV の始まり（{opening.date} の前）の残高は {yen(opening.csv)} です。差額（期首残高）を{" "}
            {yen(opening.adjustment + opening.diff)} にすると、アプリの残高と合います。
          </span>
        ))}
      {opening.diff !== 0 && (
        <Link
          href={"/bank-accounts" as never}
          className="mt-1 inline-block text-indigo-600 hover:underline"
        >
          銀行管理で差額を直す
        </Link>
      )}
    </Notice>
  );
}
