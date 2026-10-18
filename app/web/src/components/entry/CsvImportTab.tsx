"use client";

// 実績管理の「CSV インポート」タブ。取り込み先の列つきの CSV は行ごとに振り分け、列なしは画面で選んだ取り込み先に入れる。
// 銀行・カード会社・電子マネーのサイトから落とした CSV は、アプリの形にそろえてから送る（lib/shared/statement-formats.ts）。
import { useQueryClient } from "@tanstack/react-query";
import Papa from "papaparse";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { CsvDropzone, Notice } from "@/components/ui";
import { StatementLinksCard } from "@/components/entry/StatementLinksCard";
import { ENTRY_HELP } from "@/lib/shared/help-texts";
import { importErrorMessage, importNetworkErrorMessage } from "@/lib/client/import-error";
import { invalidateActuals } from "@/lib/client/invalidate-actuals";
import { yen } from "@/lib/common/format";
import { type Source, type SourceAccount } from "@/components/entry/types";
import { hasDestinationColumn } from "@/lib/ledger/ledger-import";
import {
  AMOUNT_STYLE_LABEL,
  convertStatement,
  decodeCsv,
  isImportFormat,
  toImportCsv,
  type StatementConversion,
} from "@/lib/shared/statement-formats";
import { useActualsScope } from "@/lib/client/use-view-mode";

// CSV インポートの結果（POST /api/imports）。取り込み先ごとの登録件数と、重複・確定済みの月で飛ばした件数
// offset は自動相殺で振替・チャージの組にした数
type ImportCount = {
  kind: "CASH" | "BANK" | "CARD";
  id: number | null;
  name: string;
  inserted: number;
  skipped: number;
  locked: number;
  offset: number;
};
type ImportResult = {
  results: ImportCount[] | null;
  errors: { row: number; message: string }[];
};
const IMPORT_KIND_LABEL: Record<ImportCount["kind"], string> = {
  CASH: "現金",
  BANK: "銀行",
  CARD: "カード・電子マネー",
};

const THIS_YEAR = new Date().getFullYear();

/** 取り込み前の確認に出す、変換した明細の行数 */
const PREVIEW_ROWS = 5;

// 取り込みの前の確認。csv は送る中身（各社の形から変換したときは、そろえたあとの CSV）
type PendingImport = {
  fileName: string;
  label: string;
  csv: string;
  /** 各社の形から変換したときの結果（アプリの形のままなら null） */
  conversion: StatementConversion | null;
  /** 明細の形と取り込み先が食い違って見えるときの注意 */
  warning: string | null;
};

/** 明細の形から見て、取り込み先を取り違えていそうなら注意を返す */
function kindWarning(source: Source, c: StatementConversion): string | null {
  if (c.style === "usage" && source !== "card") {
    return "カードの利用明細のようです。取り込み先が合っているか確かめてください。";
  }
  if (source === "card" && c.columns.some((col) => col.role === "残高")) {
    return "残高の列がある、銀行の明細のようです。取り込み先が合っているか確かめてください。";
  }
  return null;
}

export function CsvImportTab({
  source,
  bankAccountId,
  cardId,
  bankAccounts,
  cardAccounts,
}: {
  source: Source;
  /** 取り込み先の銀行（null は未選択） */
  bankAccountId: number | null;
  /** 取り込み先のカード（null は未選択） */
  cardId: number | null;
  bankAccounts: SourceAccount[] | undefined;
  cardAccounts: SourceAccount[] | undefined;
}) {
  const queryClient = useQueryClient();
  // ── CSV インポート ─────────────────────────────────────────────
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  // 個人事業主モードだけ「事業利用として取り込む」を出す（初期値はオフ。銀行の CSV には家計の分も混ざるため。
  // 事業利用の口座・カードへの取り込みは、この印が無くても事業利用で入る）
  const scope = useActualsScope();
  const [asBusiness, setAsBusiness] = useState(false);

  // ── CSV ハンドラ ─────────────────────────────────────────────
  // 取り込みの前の確認（登録先の列が無い CSV を入れるとき。取り違えを防ぎ、変換した中身を見せる）
  const [pendingImport, setPendingImport] = useState<PendingImport | null>(null);

  async function importFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("CSV ファイル (.csv) のみ対応しています。");
      return;
    }
    setImportResult(null);
    setImportError(null);
    // 銀行・カード会社の CSV は Shift_JIS が多いので、文字コードを見分けて読む（送るのは UTF-8）
    const text = decodeCsv(await file.arrayBuffer());
    const header = Papa.parse<string[]>(text, { preview: 1 }).data[0] ?? [];
    // ヘッダに取り込み先の列（取り込み先 / account）があれば行ごとに振り分ける（画面の取り込み先は使わない）
    if (hasDestinationColumn(header)) {
      await runImport(text);
      return;
    }

    let label = "現金";
    if (source !== "manual") {
      const list = source === "bank" ? bankAccounts : cardAccounts;
      const id = source === "bank" ? bankAccountId : cardId;
      const account = list?.find((a) => a.id === id);
      if (!account) {
        setImportError(
          "取り込み先の口座を選んでください（CSV に取り込み先の列があれば、行ごとに振り分けます）。",
        );
        return;
      }
      label = `${source === "bank" ? "銀行" : "カード・電子マネー"}: ${account.name}`;
    }

    // アプリの形（日付・摘要・金額）でなければ、各社の明細として読んでそろえる
    if (isImportFormat(header)) {
      setPendingImport({ fileName: file.name, label, csv: text, conversion: null, warning: null });
      return;
    }
    const conversion = convertStatement(text);
    if (!conversion) {
      setImportError(
        "明細の形を読み取れませんでした。日付と金額（出金・入金・利用金額など）の列名が入った見出しの行があるか確かめてください。",
      );
      return;
    }
    if (conversion.rows.length === 0) {
      setImportError("取り込める明細がありませんでした（日付と金額のある行がありません）。");
      return;
    }
    setPendingImport({
      fileName: file.name,
      label,
      csv: toImportCsv(conversion.rows),
      conversion,
      warning: kindWarning(source, conversion),
    });
  }

  async function runImport(csv: string) {
    setPendingImport(null);
    setImporting(true);
    try {
      const params = new URLSearchParams({
        target: source === "manual" ? "cash" : source,
      });
      const id = source === "bank" ? bankAccountId : source === "card" ? cardId : null;
      if (id !== null) params.set("accountId", String(id));
      if (scope === "business" && asBusiness) params.set("business", "1");
      const res = await fetch(`/api/imports?${params}`, {
        method: "POST",
        headers: { "Content-Type": "text/csv; charset=utf-8" },
        body: csv,
      });
      const json = await res
        .clone()
        .json()
        .catch(() => null);
      if (json && Array.isArray(json.errors)) {
        setImportResult(json as ImportResult);
      } else if (!res.ok) {
        setImportError(await importErrorMessage(res));
      }
      // 学習ルールで科目が付いた明細はそのまま実績になるので、実績もまとめて取り直す
      invalidateActuals(queryClient);
      for (const key of [
        "bank-txns",
        "card-txns",
        "bank-accounts",
        "cash-outlook",
        "card-usage-trend",
      ]) {
        queryClient.invalidateQueries({ queryKey: [key] });
      }
    } catch {
      setImportError(importNetworkErrorMessage);
    } finally {
      setImporting(false);
    }
  }

  return (
    <>
      <div className="max-w-2xl space-y-6">
        <StatementLinksCard
          source={source}
          selectedId={source === "bank" ? bankAccountId : source === "card" ? cardId : null}
          bankAccounts={bankAccounts}
          cardAccounts={cardAccounts}
        />
        <CsvDropzone busy={importing} onFile={importFile} />
        {scope === "business" && (
          <label className="flex items-start gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={asBusiness}
              onChange={(e) => setAsBusiness(e.target.checked)}
              className="mt-1"
            />
            <span>
              事業利用として取り込む
              <span className="block text-xs text-slate-500">
                学習ルールが事業利用を決めていない明細を、事業利用（按分は科目の事業利用按分の割合、無ければ
                100%）で取り込みます。事業利用の口座・カードへの取り込みは、印を付けなくても事業利用になります。
              </span>
            </span>
          </label>
        )}
        {importResult && (
          <div
            className={`card border ${importResult.errors.length === 0 ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}
          >
            {importResult.results ? (
              <div className="flex items-start gap-3">
                <span className="text-2xl">✅</span>
                <ul className="text-sm text-slate-800 space-y-0.5">
                  {importResult.results.map((r) => (
                    <li key={`${r.kind}${r.id ?? ""}`}>
                      {IMPORT_KIND_LABEL[r.kind]}
                      {r.kind !== "CASH" && ` ${r.name}`}: {r.inserted.toLocaleString()} 件を登録
                      {r.skipped > 0 && `（${r.skipped.toLocaleString()} 件は取り込み済み）`}
                      {r.locked > 0 &&
                        `（${r.locked.toLocaleString()} 件は実績を確定済みの月のため飛ばしました）`}
                      {r.offset > 0 &&
                        `（${r.offset.toLocaleString()} 組を振替・チャージにしました）`}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <div className="flex items-center gap-3 mb-3">
                <span className="text-2xl">⚠️</span>
                <p className="text-sm font-semibold text-slate-800">
                  {importResult.errors.length} 件のエラーがあるため、取り込みませんでした
                </p>
              </div>
            )}
            {importResult.errors.length > 0 && (
              <div className="mt-3 max-h-48 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-amber-200">
                      <th className="text-left pb-1 w-16">行番号</th>
                      <th className="text-left pb-1">エラー内容</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-amber-100">
                    {importResult.errors.map((err, i) => (
                      <tr key={i} className="text-slate-600">
                        <td className="py-1 font-mono">{err.row}</td>
                        <td className="py-1">{err.message}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {importError && <Notice tone="error">{importError}</Notice>}

        {/* 書式の説明（取り込み先の列つき / 列なし） */}
        <div className="card bg-slate-50 space-y-4">
          <div>
            <h3 className="text-xs font-semibold text-slate-700 mb-2">
              取り込み先の列つき（1 つのファイルで、現金・銀行・カードにまとめて登録する）
            </h3>
            <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded p-3 overflow-x-auto">{`取り込み先,日付,摘要,金額,残高
住信SBI普通,${THIS_YEAR}-06-25,給与,300000,512000
楽天カード,${THIS_YEAR}-06-27,AMAZON.CO.JP,-3980,
現金,${THIS_YEAR}-06-28,八百屋,-650,`}</pre>
            <p className="mt-1 text-xs text-slate-500">{ENTRY_HELP.csvRouted}</p>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-700 mb-2">
              取り込み先の列なし（上で選んだ現金・口座・カードに入れる）
            </h3>
            <pre className="text-xs text-slate-600 font-mono bg-white border border-slate-200 rounded p-3 overflow-x-auto">{`日付,摘要,金額,残高
${THIS_YEAR}-06-25,給与,300000,512000
${THIS_YEAR}-06-27,AMAZON.CO.JP,-3980,508020`}</pre>
            <p className="mt-1 text-xs text-slate-500">
              英語の列名 date・description・amount・balance
              でもかまいません。入金は正、支出は負。残高は銀行だけで、無くてもかまいません。
            </p>
          </div>
          <div>
            <h3 className="text-xs font-semibold text-slate-700 mb-2">
              銀行・カード会社・電子マネーのサイトから落とした CSV
            </h3>
            <p className="text-xs text-slate-500">
              そのまま入れられます（Shift_JIS
              でもかまいません）。見出しの列名から、日付・摘要・出金と入金（または利用金額、符号つきの金額）・残高を読み取り、取り込む前に変換した中身を確認できます。見出しの前の口座の情報や、末尾の合計の行は飛ばします。見出しの無いカード明細は、先頭から
              日付・摘要・利用金額 の並びとして読みます。
            </p>
          </div>
        </div>
      </div>

      {pendingImport && (
        <Modal size="md">
          <h2 className="text-lg font-bold text-slate-800 mb-1">CSV 取込先の確認</h2>
          <p className="text-xs text-slate-500 mb-4">
            CSV の中身から取込先は判別できません。下記の明細として登録します。
          </p>
          <dl className="text-sm border border-slate-200 rounded-lg divide-y divide-slate-100 mb-4">
            <div className="flex gap-3 px-3 py-2">
              <dt className="w-20 shrink-0 text-slate-500">ファイル</dt>
              <dd className="text-slate-700 break-all">{pendingImport.fileName}</dd>
            </div>
            <div className="flex gap-3 px-3 py-2 bg-amber-50">
              <dt className="w-20 shrink-0 text-slate-500">取込先</dt>
              <dd className="font-semibold text-slate-800">{pendingImport.label}</dd>
            </div>
            {pendingImport.conversion && (
              <div className="flex gap-3 px-3 py-2">
                <dt className="w-20 shrink-0 text-slate-500">読み方</dt>
                <dd className="text-slate-700 space-y-0.5">
                  <p>
                    {pendingImport.conversion.headerless
                      ? "見出しの無いカード明細（日付・摘要・利用金額の並び）"
                      : AMOUNT_STYLE_LABEL[pendingImport.conversion.style]}
                  </p>
                  <p className="text-xs text-slate-500">
                    {pendingImport.conversion.columns
                      .map((c) => `${c.role}=${c.names.join("＋")}`)
                      .join("、")}
                  </p>
                </dd>
              </div>
            )}
          </dl>
          {pendingImport.warning && (
            <Notice tone="warn" className="mb-4">
              {pendingImport.warning}
            </Notice>
          )}
          {pendingImport.conversion && <ConversionPreview conversion={pendingImport.conversion} />}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingImport(null)}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              キャンセル
            </button>
            <button
              type="button"
              onClick={() => runImport(pendingImport.csv)}
              className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-lg"
            >
              取り込む
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}

/** 各社の形から変換した明細の先頭の行と、飛ばした行（取り込み前の確認に出す） */
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
