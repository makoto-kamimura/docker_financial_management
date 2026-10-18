"use client";

// 実績管理の取り込み（銀行・カード）。選んだ口座・カードの明細を、銀行・カード会社・電子マネーのサイトから
// 落とした CSV で取り込む。CSV はブラウザでアプリの形にそろえ（lib/shared/statement-formats.ts）、確認のあと
// POST /api/imports に送る（取り込み・重複の判定はサーバー）。
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileDropzone, Notice } from "@/components/ui";
import { StatementLinksCard } from "@/components/entry/StatementLinksCard";
import {
  StatementImportConfirm,
  type ImportPreview,
} from "@/components/entry/StatementImportConfirm";
import { importErrorMessage, importNetworkErrorMessage } from "@/lib/client/import-error";
import { invalidateActuals } from "@/lib/client/invalidate-actuals";
import { useActualsScope } from "@/lib/client/use-view-mode";
import {
  convertStatement,
  decodeCsv,
  toImportCsv,
  type StatementConversion,
} from "@/lib/shared/statement-formats";
import { type SourceAccount } from "@/components/entry/types";

/** 取り込みの結果（POST /api/imports）。skipped は重複、locked は確定済みの月のため飛ばした件数、offset は振替・チャージにした組の数 */
type ImportResult = {
  result: { inserted: number; skipped: number; locked: number; offset: number } | null;
  errors: { row: number; message: string }[];
};

type Pending = {
  /** 読んだファイルごとの番号（試し取り込みの結果を、別のファイルの確認に入れないため） */
  id: number;
  fileName: string;
  conversion: StatementConversion;
  warning: string | null;
  preview: ImportPreview | "loading" | "failed";
};

let lastPendingId = 0;

/** 明細の形から見て、取り込み先を取り違えていそうなら注意を返す */
function kindWarning(kind: "bank" | "card", c: StatementConversion): string | null {
  if (c.style === "usage" && kind !== "card") {
    return "カードの利用明細のようです。取り込み先が合っているか確かめてください。";
  }
  if (kind === "card" && c.columns.some((col) => col.role === "残高")) {
    return "残高の列がある、銀行の明細のようです。取り込み先が合っているか確かめてください。";
  }
  return null;
}

export function StatementImportPanel({
  kind,
  account,
}: {
  kind: "bank" | "card";
  /** 取り込み先の口座・カード（null は未選択） */
  account: SourceAccount | null;
}) {
  const queryClient = useQueryClient();
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  // 個人事業主モードだけ「事業利用として取り込む」を出す（初期値はオフ。銀行の CSV には家計の分も混ざるため。
  // 事業利用の口座・カードへの取り込みは、この印が無くても事業利用で入る）
  const scope = useActualsScope();
  const [asBusiness, setAsBusiness] = useState(false);

  const typeLabel = kind === "bank" ? "銀行" : "カード・電子マネー";

  if (!account) {
    return (
      <div className="max-w-2xl">
        <Notice tone="info">
          上で取り込み先の{kind === "bank" ? "口座" : "カード"}を選んでください。
        </Notice>
      </div>
    );
  }

  function importParams({ dryRun }: { dryRun: boolean }) {
    const params = new URLSearchParams({ target: kind, accountId: String(account!.id) });
    if (scope === "business" && asBusiness) params.set("business", "1");
    if (dryRun) params.set("dryRun", "1");
    return params;
  }

  async function readFile(file: File) {
    setResult(null);
    setError(null);
    if (!file.name.toLowerCase().endsWith(".csv")) {
      setError("CSV ファイル (.csv) を選んでください。");
      return;
    }
    // 銀行・カード会社の CSV は Shift_JIS が多いので、文字コードを見分けて読む（送るのは UTF-8）
    const conversion = convertStatement(decodeCsv(await file.arrayBuffer()));
    if (!conversion) {
      setError(
        "明細の形を読み取れませんでした。日付と金額（出金・入金・利用金額など）の列名が入った見出しの行があるか確かめてください。",
      );
      return;
    }
    if (conversion.rows.length === 0) {
      setError("取り込める明細がありませんでした（日付と金額のある行がありません）。");
      return;
    }
    const id = ++lastPendingId;
    setPending({
      id,
      fileName: file.name,
      conversion,
      warning: kindWarning(kind, conversion),
      preview: "loading",
    });
    // 取り込み済みの明細と照らし合わせる（書き込まない）
    let preview: ImportPreview | "failed" = "failed";
    try {
      const res = await fetch(`/api/imports?${importParams({ dryRun: true })}`, {
        method: "POST",
        headers: { "Content-Type": "text/csv; charset=utf-8" },
        body: toImportCsv(conversion.rows),
      });
      if (res.ok) preview = (await res.json()).preview as ImportPreview;
    } catch {
      // 照らし合わせられなくても、取り込みはできる（同じ明細は重ねて登録されない）
    }
    setPending((p) => (p?.id === id ? { ...p, preview } : p));
  }

  async function runImport(csv: string) {
    setPending(null);
    setImporting(true);
    try {
      const res = await fetch(`/api/imports?${importParams({ dryRun: false })}`, {
        method: "POST",
        headers: { "Content-Type": "text/csv; charset=utf-8" },
        body: csv,
      });
      const json = await res
        .clone()
        .json()
        .catch(() => null);
      if (json && Array.isArray(json.errors)) {
        setResult(json as ImportResult);
      } else if (!res.ok) {
        setError(await importErrorMessage(res));
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
      setError(importNetworkErrorMessage);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="max-w-2xl space-y-4">
      <StatementLinksCard kind={kind === "bank" ? "BANK" : "CARD"} account={account} />

      <div className="card space-y-3">
        <div>
          <p className="text-sm font-medium text-slate-700">② CSV を入れる</p>
          <p className="text-xs text-slate-500 mt-0.5">
            サイトから保存した CSV をそのまま入れます（Shift_JIS
            でもかまいません）。見出しの列名から日付・摘要・金額・残高を読み取り、取り込む前に中身を確かめられます。
          </p>
        </div>
        <FileDropzone busy={importing} busyLabel="取り込み中…" onFiles={([f]) => readFile(f)} />
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
      </div>

      {result && <ResultCard result={result} />}
      {error && <Notice tone="error">{error}</Notice>}

      {pending && (
        <StatementImportConfirm
          fileName={pending.fileName}
          label={`${typeLabel}: ${account.name}`}
          conversion={pending.conversion}
          warning={pending.warning}
          preview={pending.preview}
          onCancel={() => setPending(null)}
          onConfirm={(excluded) =>
            runImport(toImportCsv(pending.conversion.rows.filter((_, i) => !excluded.has(i))))
          }
        />
      )}
    </div>
  );
}

function ResultCard({ result: { result, errors } }: { result: ImportResult }) {
  return (
    <div
      className={`card border ${errors.length === 0 ? "border-green-200 bg-green-50" : "border-amber-200 bg-amber-50"}`}
    >
      {result ? (
        <p className="text-sm text-slate-800">
          ✅ {result.inserted.toLocaleString()} 件を登録しました
          {result.skipped > 0 && `（${result.skipped.toLocaleString()} 件は取り込み済み）`}
          {result.locked > 0 &&
            `（${result.locked.toLocaleString()} 件は実績を確定済みの月のため飛ばしました）`}
          {result.offset > 0 &&
            `（${result.offset.toLocaleString()} 組を振替・チャージにしました）`}
        </p>
      ) : (
        <p className="text-sm font-semibold text-slate-800">
          ⚠️ {errors.length} 件のエラーがあるため、取り込みませんでした
        </p>
      )}
      {errors.length > 0 && (
        <div className="mt-3 max-h-48 overflow-y-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-500 border-b border-amber-200">
                <th className="text-left pb-1 w-16">行番号</th>
                <th className="text-left pb-1">エラー内容</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-amber-100">
              {errors.map((err, i) => (
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
  );
}
