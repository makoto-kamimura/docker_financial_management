"use client";

// 実績管理の現金の入力で使う「レシートを撮影して入力」。撮った写真を読み取り、下書きを親のフォームに渡す。
// 有料プランは高精度（Claude）、無料プランは簡易（サーバーの中の OCR）で読む。登録は親のフォームで行い、
// 登録した明細には、ここで縮めた写真を証憑として付ける（onScanned の photo）。

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera } from "lucide-react";
import { resizeImageToJpeg } from "@/lib/client/resize-image";
import type { ReceiptDraft, ReceiptEngine } from "@/lib/ledger/receipt-scan/types";
import type { ReceiptScanStatus, ScanOutcome } from "@/lib/ledger/receipt-scan/scan";

export type ReceiptScanResult = Omit<ScanOutcome, "requestId">;

const ENGINE_LABELS: Record<ReceiptEngine, string> = {
  claude: "高精度の読み取り（有料プラン）",
  tesseract: "簡易の読み取り（精度は低め）",
};

const PAYMENT_WARNINGS: Partial<Record<ReceiptDraft["paymentMethod"], string>> = {
  card: "カード払いのレシートのようです。カードの明細から入る分と二重に計上しないよう注意してください。",
  emoney:
    "電子マネーや QR コード決済のレシートのようです。電子マネーの明細から入る分と二重に計上しないよう注意してください。",
};

export function ReceiptScanButton({
  onScanned,
}: {
  onScanned: (r: ReceiptScanResult, photo: File) => void;
}) {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);

  const { data: status } = useQuery({
    queryKey: ["receipt-scan-status"],
    queryFn: async (): Promise<ReceiptScanStatus | null> => {
      const res = await fetch("/api/actuals/receipt-scan");
      return res.ok ? (await res.json()).data : null;
    },
  });

  // 前の写真の表示用 URL を解放する
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function handleFile(file: File | undefined) {
    if (!file) return;
    setError("");
    setWarning(null);
    setScanning(true);
    setPreview(URL.createObjectURL(file));
    try {
      const photo = await resizeImageToJpeg(file);
      const body = new FormData();
      body.append("file", photo);
      const res = await fetch("/api/actuals/receipt-scan", { method: "POST", body });
      const json = (await res.json().catch(() => ({}))) as {
        data?: ReceiptScanResult;
        error?: string;
      };
      if (!res.ok || !json.data) {
        setError(json.error ?? "読み取りに失敗しました");
        return;
      }
      setWarning(PAYMENT_WARNINGS[json.data.draft.paymentMethod] ?? null);
      onScanned(json.data, photo);
    } catch {
      setError("読み取りに失敗しました。通信状態を確かめてください");
    } finally {
      setScanning(false);
      if (inputRef.current) inputRef.current.value = "";
      void qc.invalidateQueries({ queryKey: ["receipt-scan-status"] });
    }
  }

  if (!status) return null;
  const disabled = scanning || status.reason !== null;

  return (
    <div className="flex flex-col gap-1.5 mb-3">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handleFile(e.target.files?.[0])}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="btn-secondary text-xs inline-flex items-center justify-center gap-1.5"
      >
        <Camera className="w-3.5 h-3.5" aria-hidden />
        {scanning ? "読み取り中…" : "レシートを撮影して入力"}
      </button>
      <p className="text-[10px] text-slate-400">
        {ENGINE_LABELS[status.engine]}・今日あと {status.remaining} 回
      </p>
      {status.upgradeAvailable && (
        <Link
          href={"/settings?tab=billing" as never}
          className="text-[10px] text-indigo-600 hover:underline"
        >
          有料プランにすると、高精度で読み取れます
        </Link>
      )}
      {status.reason && <p className="text-[10px] text-amber-700">{status.reason}</p>}
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- 撮ったばかりの写真（blob:）を出すだけ
        <img
          src={preview}
          alt="撮影したレシート"
          className="max-h-32 w-auto self-start rounded border border-slate-200"
        />
      )}
      {!scanning && preview && !error && (
        <p className="text-[10px] text-emerald-700">
          読み取った内容をフォームに入れました。確かめてから登録してください。
        </p>
      )}
      {warning && <p className="text-[10px] text-amber-700">{warning}</p>}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
