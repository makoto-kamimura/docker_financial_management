"use client";

// 控除・確定申告の書類のファイル。書類ごとに保存した証明書の画像・PDF（追加・開く・削除）と、
// セルフメディケーション税制の対象として残したレシートの一覧（/api/tax-return/documents）。

import { useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Paperclip, Trash2 } from "lucide-react";
import { yen } from "@/lib/common/format";

export type TaxDocumentFile = {
  id: number;
  docId: string;
  fileName: string;
  fileType: string;
  fileUrl: string;
  uploadedAt: string;
};

export type SelfMedicationReceipt = {
  id: number;
  date: string | null;
  merchant: string;
  amount: number;
  items: { name: string; amount: number }[];
  fileName: string;
  fileType: string;
  fileUrl: string;
};

type DocumentsPayload = {
  documents: TaxDocumentFile[];
  selfMedicationReceipts: SelfMedicationReceipt[];
};

const queryKey = (year: number) => ["tax-return-documents", year] as const;

export function useTaxDocuments(year: number) {
  return useQuery({
    queryKey: queryKey(year),
    queryFn: async (): Promise<DocumentsPayload> => {
      const res = await fetch(`/api/tax-return/documents?year=${year}`);
      if (!res.ok) throw new Error("書類の一覧を読み込めませんでした");
      return (await res.json()).data;
    },
  });
}

function Thumb({ url, fileType, name }: { url: string; fileType: string; name: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      title={name}
      className="flex h-16 w-16 items-center justify-center overflow-hidden rounded border border-slate-200 bg-slate-50"
    >
      {fileType === "image" ? (
        // 証明書の画像は認証付きの API から配信するので、next/image の最適化は使わない
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={name} className="h-full w-full object-cover" />
      ) : (
        <FileText className="h-6 w-6 text-slate-400" aria-label="PDF" />
      )}
    </a>
  );
}

/** 1 つの書類の、保存したファイルと「画像を追加」 */
export function DocumentFiles({
  year,
  docId,
  files,
}: {
  year: number;
  docId: string;
  files: TaxDocumentFile[];
}) {
  const qc = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function upload(file: File) {
    setBusy(true);
    setError("");
    const body = new FormData();
    body.append("year", String(year));
    body.append("docId", docId);
    body.append("file", file);
    const res = await fetch("/api/tax-return/documents", { method: "POST", body });
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      setError(j.error ?? "保存できませんでした");
    }
    await qc.invalidateQueries({ queryKey: queryKey(year) });
    setBusy(false);
  }

  async function remove(id: number) {
    if (!confirm("このファイルを削除しますか？")) return;
    const res = await fetch(`/api/tax-return/documents/${id}`, { method: "DELETE" });
    if (!res.ok) setError("削除できませんでした");
    await qc.invalidateQueries({ queryKey: queryKey(year) });
  }

  return (
    <div className="mt-2 pl-6">
      <div className="flex flex-wrap items-end gap-2">
        {files.map((f) => (
          <div key={f.id} className="relative">
            <Thumb url={f.fileUrl} fileType={f.fileType} name={f.fileName} />
            <button
              type="button"
              onClick={() => remove(f.id)}
              aria-label={`${f.fileName} を削除`}
              className="absolute -right-1.5 -top-1.5 rounded-full border border-slate-200 bg-white p-0.5 text-slate-400 hover:text-red-500"
            >
              <Trash2 className="h-3 w-3" aria-hidden="true" />
            </button>
          </div>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => input.current?.click()}
          className="btn-secondary btn-sm inline-flex items-center gap-1"
        >
          <Paperclip className="h-3.5 w-3.5" aria-hidden="true" />
          {busy ? "保存中…" : "画像を追加"}
        </button>
        <input
          ref={input}
          type="file"
          accept="image/*,application/pdf"
          capture="environment"
          className="hidden"
          aria-label="証明書の画像"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void upload(file);
          }}
        />
      </div>
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

/** セルフメディケーション税制の対象として残したレシートの一覧 */
export function SelfMedicationReceipts({
  receipts,
  onUseTotal,
}: {
  receipts: SelfMedicationReceipt[];
  onUseTotal: (total: number) => void;
}) {
  const total = receipts.reduce((s, r) => s + r.amount, 0);
  if (receipts.length === 0) {
    return (
      <p className="text-sm text-slate-500">
        まだありません。実績管理でレシートを撮影して入力するときに「セルフメディケーション税制の対象」にすると、ここに残ります。
      </p>
    );
  }
  return (
    <>
      <ul className="divide-y divide-slate-100">
        {receipts.map((r) => (
          <li key={r.id} className="flex items-start gap-3 py-2">
            <Thumb url={r.fileUrl} fileType={r.fileType} name={r.fileName} />
            <div className="min-w-0 flex-1 text-sm">
              <div className="flex justify-between gap-2">
                <span className="font-medium text-slate-800">
                  {r.date?.replaceAll("-", "/")} {r.merchant}
                </span>
                <span className="tabular-nums font-semibold text-slate-900">{yen(r.amount)}</span>
              </div>
              {r.items.length > 0 && (
                <p className="mt-0.5 text-xs text-slate-500">
                  {r.items.map((i) => `${i.name} ${yen(i.amount)}`).join("、")}
                </p>
              )}
            </div>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="text-sm text-slate-700">
          合計 <span className="font-semibold tabular-nums">{yen(total)}</span>（{receipts.length}{" "}
          枚）
        </span>
        <button type="button" className="btn-secondary btn-sm" onClick={() => onUseTotal(total)}>
          この合計を購入額に使う
        </button>
      </div>
    </>
  );
}
