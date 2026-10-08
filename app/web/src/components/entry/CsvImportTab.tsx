"use client";

// 実績管理の「CSV インポート」タブ。取り込み先の列つきの CSV は行ごとに振り分け、列なしは画面で選んだ取り込み先に入れる。
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { CsvDropzone, Notice } from "@/components/ui";
import { ENTRY_HELP } from "@/lib/help-texts";
import { importErrorMessage, importNetworkErrorMessage } from "@/lib/import-error";
import { invalidateActuals } from "@/lib/invalidate-actuals";
import { type Source, type SourceAccount } from "@/components/entry/types";

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

  // ── CSV ハンドラ ─────────────────────────────────────────────
  // 取り込みの前の確認（銀行・カードへ、登録先の列が無い CSV を入れるとき。取り違えを防ぐ）
  const [pendingImport, setPendingImport] = useState<{ file: File; label: string } | null>(null);

  async function importFile(file: File) {
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setImportError("CSV ファイル (.csv) のみ対応しています。");
      return;
    }
    setImportResult(null);
    setImportError(null);
    // ヘッダに取り込み先の列（取り込み先 / account）があれば行ごとに振り分ける（画面の取り込み先は使わない）
    const header = (await file.text()).split(/\r?\n/, 1)[0] ?? "";
    const routed = header
      .split(",")
      .map((h) =>
        h
          .trim()
          .replace(/^"|"$/g, "")
          .replace(/^\uFEFF/, ""),
      )
      .some((h) => h === "取り込み先" || h === "account");
    if (!routed) {
      if (source === "manual") {
        setPendingImport({ file, label: "現金" });
        return;
      }
      const list = source === "bank" ? bankAccounts : cardAccounts;
      const id = source === "bank" ? bankAccountId : cardId;
      const account = list?.find((a) => a.id === id);
      if (!account) {
        setImportError(
          "取り込み先の口座を選んでください（CSV に取り込み先の列があれば、行ごとに振り分けます）。",
        );
        return;
      }
      setPendingImport({
        file,
        label: `${source === "bank" ? "銀行" : "カード・電子マネー"}: ${account.name}`,
      });
      return;
    }
    await runImport(file);
  }

  async function runImport(file: File) {
    setPendingImport(null);
    setImporting(true);
    try {
      const params = new URLSearchParams({
        target: source === "manual" ? "cash" : source,
      });
      const id = source === "bank" ? bankAccountId : source === "card" ? cardId : null;
      if (id !== null) params.set("accountId", String(id));
      const res = await fetch(`/api/imports?${params}`, {
        method: "POST",
        headers: { "Content-Type": "text/csv; charset=utf-8" },
        body: file,
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

  // 銀行の自動取得（同期）。銀行管理の CSV インポートから移した
  async function syncBank() {
    if (bankAccountId === null) return;
    setImportResult(null);
    setImportError(null);
    const res = await fetch(`/api/bank-accounts/${bankAccountId}/sync`, { method: "POST" });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      const name = bankAccounts?.find((a) => a.id === bankAccountId)?.name ?? "";
      setImportResult({
        results: [
          {
            kind: "BANK",
            id: bankAccountId,
            name,
            inserted: json.inserted ?? 0,
            skipped: json.skipped ?? 0,
            locked: json.locked ?? 0,
            offset: json.offset ?? 0,
          },
        ],
        errors: [],
      });
      queryClient.invalidateQueries({ queryKey: ["bank-txns"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts"] });
      invalidateActuals(queryClient);
    } else {
      setImportError("自動取得に失敗しました。");
    }
  }

  return (
    <>
      <div className="max-w-2xl space-y-6">
        <CsvDropzone busy={importing} onFile={importFile} />
        {/* 銀行の自動取得（同期）。銀行管理の CSV インポートから移した */}
        {source === "bank" && bankAccountId !== null && (
          <div className="card flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-slate-700">自動取得（同期）</p>
              <p className="text-xs text-slate-400 mt-0.5">口座と連携して最新の明細を取得します</p>
            </div>
            <button onClick={syncBank} className="btn-secondary whitespace-nowrap">
              同期する
            </button>
          </div>
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
              銀行・カード会社のサイトの明細そのままの形式です（英語の列名
              date・description・amount・balance
              でもかまいません。入金は正、支出は負。残高は銀行だけで、無くてもかまいません）。
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
              <dd className="text-slate-700 break-all">{pendingImport.file.name}</dd>
            </div>
            <div className="flex gap-3 px-3 py-2 bg-amber-50">
              <dt className="w-20 shrink-0 text-slate-500">取込先</dt>
              <dd className="font-semibold text-slate-800">{pendingImport.label}</dd>
            </div>
          </dl>
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
              onClick={() => runImport(pendingImport.file)}
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
