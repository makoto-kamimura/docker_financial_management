"use client";

// 控除・確定申告の書類のファイル。書類ごとに保存した証明書の画像・PDF（撮影・アップロード・開く・削除。
// それぞれの入力欄のそばに置く）と、セルフメディケーション税制の対象として残したレシートの一覧
// （/api/tax-return/documents）。

import { useRef, useState, type ChangeEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, FileText, Trash2, Upload } from "lucide-react";
import { yen } from "@/lib/common/format";
import {
  documentsAt,
  showDocument,
  TAX_DOCUMENTS,
  type TaxDocumentId,
  type TaxDocumentPlace,
} from "@/lib/shared/tax-documents";

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

/**
 * 1 つの書類の、保存したファイル（開く・削除）と「撮影」「アップロード」。入力欄のそばに置く。
 * 今の入力で要らず、ファイルも無いときは出さない（documents は見込みの「必要な書類」）
 */
export function DocumentUpload({
  year,
  docId,
  documents,
  hint,
}: {
  year: number;
  docId: TaxDocumentId;
  documents: { id: string }[];
  hint?: string;
}) {
  const qc = useQueryClient();
  const { data } = useTaxDocuments(year);
  const camera = useRef<HTMLInputElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const files = (data?.documents ?? []).filter((f) => f.docId === docId);
  if (!showDocument(docId, documents, files)) return null;
  const label = TAX_DOCUMENTS[docId].label;

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

  const onPicked = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (file) void upload(file);
  };

  return (
    <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium text-slate-700">
          {label}
          <span className={`ml-2 badge ${files.length > 0 ? "badge-green" : "badge-amber"}`}>
            {files.length > 0 ? `保存済み ${files.length} 枚` : "未保存"}
          </span>
          {hint && <span className="mt-0.5 block font-normal text-slate-500">{hint}</span>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={() => camera.current?.click()}
            className="btn-secondary btn-sm inline-flex items-center gap-1"
          >
            <Camera className="h-3.5 w-3.5" aria-hidden="true" />
            撮影
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => picker.current?.click()}
            className="btn-secondary btn-sm inline-flex items-center gap-1"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden="true" />
            {busy ? "保存中…" : "アップロード"}
          </button>
        </div>
      </div>
      {files.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2">
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
        </div>
      )}
      <input
        ref={camera}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        aria-label={`${label}を撮影`}
        onChange={onPicked}
      />
      <input
        ref={picker}
        type="file"
        accept="image/*,application/pdf"
        className="hidden"
        aria-label={`${label}をアップロード`}
        onChange={onPicked}
      />
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

/** 撮影・アップロードの欄に添える、書類がいつ・どこから届くか */
const HINTS: Partial<Record<TaxDocumentId, string>> = {
  withholdingSlip:
    "年末調整の後（12〜1 月ごろ）に勤め先から届きます。届いたら給与収入と源泉徴収税額をその額で上書きすると正確です",
  businessStatement: "決算のあとに作る書類です",
  socialInsuranceCert: "国民年金は 11 月ごろに日本年金機構から届きます",
  mutualAidCert: "10〜11 月ごろに国民年金基金連合会・中小機構から届きます",
  lifeInsuranceCert: "10〜11 月ごろに保険会社から届きます（契約ごとに 1 枚）",
  earthquakeCert: "10〜11 月ごろに保険会社から届きます",
  medicalStatement: "領収書や、健康保険組合の医療費通知",
  healthCheckProof: "セルフメディケーション税制の条件（健康診断・予防接種など）の結果通知や領収書",
  donationReceipt: "寄付先の自治体から届く受領証明書（寄付先ごと）",
  housingBalanceCert:
    "10 月ごろに金融機関から届きます。年末残高の欄はこの証明書の額で上書きすると正確です",
  housingContract: "初年度の確定申告で使います",
  housingEnergyCert: "初年度の確定申告で、住宅の区分の証明に使います",
  housingCalc: "初年度の確定申告で作る書類です",
  disabilityProof: "本人や家族の障害者手帳など",
};

/** 置き場所の書類の撮影・アップロードの欄をまとめて出す */
export function DocumentUploads({
  year,
  place,
  documents,
}: {
  year: number;
  place: TaxDocumentPlace;
  documents: { id: string }[];
}) {
  return (
    <>
      {documentsAt(place)
        .filter((id) => TAX_DOCUMENTS[id].uploadable)
        .map((id) => (
          <DocumentUpload key={id} year={year} docId={id} documents={documents} hint={HINTS[id]} />
        ))}
    </>
  );
}

/** 医療費控除のカードに出す、セルフメディケーション税制の対象として残したレシート */
export function SelfMedicationReceiptsSection({
  year,
  show,
  onUseTotal,
}: {
  year: number;
  /** レシートが無くても出すか（セルフメディケーション税制を使うとき） */
  show: boolean;
  onUseTotal: (total: number) => void;
}) {
  const { data } = useTaxDocuments(year);
  const receipts = data?.selfMedicationReceipts ?? [];
  if (!show && receipts.length === 0) return null;
  return (
    <div className="mt-3 rounded-lg border border-dashed border-slate-300 p-3">
      <div className="mb-2 text-xs font-medium text-slate-700">
        セルフメディケーションのレシート
        <span className="mt-0.5 block font-normal text-slate-500">
          実績管理でレシートを撮影するときに「セルフメディケーション税制の対象」にしたものです。確定申告の後
          5 年間は保管が必要です。
        </span>
      </div>
      <SelfMedicationReceipts receipts={receipts} onUseTotal={onUseTotal} />
    </div>
  );
}
