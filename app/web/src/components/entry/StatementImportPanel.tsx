"use client";

// 実績管理の取り込み（銀行・カード）。選んだ口座・カードの明細を、銀行・カード会社・電子マネーのサイトから
// 落とした CSV で取り込む。CSV はブラウザでアプリの形にそろえ（lib/shared/statement-formats.ts）、確認のあと
// POST /api/imports に送る（取り込み・重複の判定はサーバー）。自動で読めない・読み違えた CSV は「読み方を選ぶ」で
// 列の役割を直し、口座・カードに覚えられる（/api/imports/mapping。次から同じ見出しの CSV に使う）。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileDropzone, Notice } from "@/components/ui";
import { StatementLinksCard } from "@/components/entry/StatementLinksCard";
import { StatementMappingEditor } from "@/components/entry/StatementMappingEditor";
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
  type StatementMapping,
} from "@/lib/shared/statement-formats";
import { type SourceAccount } from "@/components/entry/types";

/** 取り込みの結果（POST /api/imports）。skipped は重複、locked は確定済みの月のため飛ばした件数、offset は振替・チャージにした組の数 */
type ImportResult = {
  result: {
    inserted: number;
    skipped: number;
    locked: number;
    offset: number;
    /** この CSV の明細のうち、科目も振替・チャージの組も付いていない件数 */
    unassigned: number;
  } | null;
  errors: { row: number; message: string }[];
};

type Pending = {
  /** 読み直すごとの番号（試し取り込みの結果を、別の読み方の確認に入れないため） */
  id: number;
  fileName: string;
  /** CSV の中身（読み方を選び直すときに使う） */
  text: string;
  /** そろえた明細。自動で読めなかったときは null（読み方を選ぶ画面を開く） */
  conversion: StatementConversion | null;
  warning: string | null;
  preview: ImportPreview | "loading" | "failed";
  /** 読み方を選ぶ画面を開いている */
  editing: boolean;
  /** 読み方の出どころ（口座に覚えた読み方・この画面で選んだ読み方・自動） */
  mappingSource: "saved" | "edited" | "auto";
  /** 選んだ読み方を口座に覚えるか */
  remember: boolean;
};

const UNREADABLE_NOTE =
  "見出しの列名から、日付と金額の列を読み取れませんでした。見出しの行と、それぞれの列の役割を選んでください。";

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
  onShowUnassigned,
}: {
  kind: "bank" | "card";
  /** 取り込み先の口座・カード（null は未選択） */
  account: SourceAccount | null;
  /** 科目の付いていない明細を、履歴タブ（この口座・未割り当て）で開く */
  onShowUnassigned: (accountId: number) => void;
}) {
  const queryClient = useQueryClient();
  // 前回どこまで取り込んだか（次に落とす明細の期間の目安）
  const { data: lastDate } = useQuery({
    queryKey: ["import-coverage", kind, account?.id],
    enabled: account !== null,
    queryFn: async (): Promise<string | null> => {
      const params = new URLSearchParams({ target: kind, accountId: String(account!.id) });
      const res = await fetch(`/api/imports/coverage?${params}`);
      return res.ok ? (await res.json()).lastDate : null;
    },
  });
  // この口座・カードに覚えた読み方
  const { data: savedMapping } = useQuery({
    queryKey: ["import-mapping", kind, account?.id],
    enabled: account !== null,
    queryFn: async (): Promise<StatementMapping | null> => {
      const params = new URLSearchParams({ target: kind, accountId: String(account!.id) });
      const res = await fetch(`/api/imports/mapping?${params}`);
      return res.ok ? (await res.json()).mapping : null;
    },
  });
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
    // 銀行・カード会社の CSV は Shift_JIS が多いので、文字コードを見分けて読む（送るのは UTF-8）。
    // 覚えた読み方があれば、同じ見出しの CSV にはそれを使う
    const text = decodeCsv(await file.arrayBuffer());
    const conversion = convertStatement(text, { mapping: savedMapping });
    const base = { fileName: file.name, text, remember: true };
    if (!conversion || conversion.rows.length === 0) {
      setPending({
        ...base,
        id: ++lastPendingId,
        conversion: null,
        warning: null,
        preview: "failed",
        editing: true,
        mappingSource: "auto",
      });
      return;
    }
    await showConversion(base, conversion, conversion.mapped ? "saved" : "auto");
  }

  /** そろえた明細で確認の画面を出し、取り込み済みの明細と照らし合わせる（書き込まない） */
  async function showConversion(
    base: Pick<Pending, "fileName" | "text" | "remember">,
    conversion: StatementConversion,
    mappingSource: Pending["mappingSource"],
  ) {
    const id = ++lastPendingId;
    setPending({
      ...base,
      id,
      conversion,
      warning: kindWarning(kind, conversion),
      preview: "loading",
      editing: false,
      mappingSource,
    });
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

  /** 読み方を口座・カードに覚える（null なら忘れる） */
  async function saveMapping(mapping: StatementMapping | null): Promise<boolean> {
    const res = await fetch("/api/imports/mapping", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ target: kind, accountId: account!.id, mapping }),
    }).catch(() => null);
    queryClient.invalidateQueries({ queryKey: ["import-mapping"] });
    return res?.ok ?? false;
  }

  async function confirmImport(p: Pending, excluded: Set<number>) {
    const conversion = p.conversion!;
    if (p.mappingSource === "edited" && p.remember && conversion.mapping) {
      if (!(await saveMapping(conversion.mapping))) {
        setError("読み方を覚えられませんでした（明細の取り込みは続けます）。");
      }
    }
    await runImport(toImportCsv(conversion.rows.filter((_, i) => !excluded.has(i))));
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
        "import-coverage",
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
      <StatementLinksCard
        kind={kind === "bank" ? "BANK" : "CARD"}
        account={account}
        lastDate={lastDate}
      />

      <div className="card space-y-3">
        <div>
          <p className="text-sm font-medium text-slate-700">② CSV を入れる</p>
          <p className="text-xs text-slate-500 mt-0.5">
            サイトから保存した CSV をそのまま入れます（Shift_JIS
            でもかまいません）。見出しの列名から日付・摘要・金額・残高を読み取り、取り込む前に中身を確かめられます。
          </p>
        </div>
        <FileDropzone busy={importing} busyLabel="取り込み中…" onFiles={([f]) => readFile(f)} />
        {savedMapping && (
          <p className="text-xs text-slate-500">
            この{kind === "bank" ? "口座" : "カード"}には、覚えた読み方があります（同じ見出しの CSV
            に使います）。
            <button
              type="button"
              onClick={() => void saveMapping(null)}
              className="ml-1 text-indigo-600 hover:underline"
            >
              忘れる
            </button>
          </p>
        )}
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

      {result && (
        <ResultCard result={result} onShowUnassigned={() => onShowUnassigned(account.id)} />
      )}
      {error && <Notice tone="error">{error}</Notice>}

      {pending?.editing && (
        <StatementMappingEditor
          text={pending.text}
          initial={pending.conversion?.mapping ?? savedMapping ?? null}
          note={pending.conversion ? null : UNREADABLE_NOTE}
          onCancel={() => setPending(pending.conversion ? { ...pending, editing: false } : null)}
          onApply={(mapping) => {
            const conversion = convertStatement(pending.text, { mapping });
            if (conversion) void showConversion(pending, conversion, "edited");
          }}
        />
      )}
      {pending && !pending.editing && pending.conversion && (
        <StatementImportConfirm
          fileName={pending.fileName}
          label={`${typeLabel}: ${account.name}`}
          conversion={pending.conversion}
          warning={pending.warning}
          preview={pending.preview}
          mappingSource={pending.mappingSource}
          onEditMapping={() => setPending({ ...pending, editing: true })}
          remember={pending.remember}
          onRememberChange={(remember) => setPending({ ...pending, remember })}
          onCancel={() => setPending(null)}
          onConfirm={(excluded) => void confirmImport(pending, excluded)}
        />
      )}
    </div>
  );
}

function ResultCard({
  result: { result, errors },
  onShowUnassigned,
}: {
  result: ImportResult;
  onShowUnassigned: () => void;
}) {
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
      {result && result.unassigned > 0 && (
        <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-slate-700">
          科目の付いていない明細が {result.unassigned.toLocaleString()} 件あります。
          <button type="button" onClick={onShowUnassigned} className="btn-secondary text-xs">
            履歴で科目を付ける
          </button>
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
