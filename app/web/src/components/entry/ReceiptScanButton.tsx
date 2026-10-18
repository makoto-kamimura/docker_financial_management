"use client";

// 現金の明細の入力で使う、レシート・領収書の読み取り。撮った写真・選んだ画像を読み取り、下書きを返す。
// 有料プランは高精度（Claude）、無料プランは簡易（サーバーの中の OCR）で読む。登録は CashEntryForm で行い、
// 登録した明細には、ここで縮めた写真を証憑として付ける（ScannedReceipt の photo）。
//   - useReceiptScan … 読み取りと、今日の残り回数
//   - ReceiptPickButtons … 「撮影する」（スマホなどのカメラ）と「画像を選ぶ」
//   - ScanQuotaNote … 読み取りの種類・残り回数・プランの案内
//   - ReceiptScanButton … カレンダーの「実績を追加」に置く、1 枚ずつの読み取り

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Camera, ImageIcon } from "lucide-react";
import { resizeImageToJpeg } from "@/lib/client/resize-image";
import type { ReceiptEngine } from "@/lib/ledger/receipt-scan/types";
import type { ReceiptScanStatus, ScanOutcome } from "@/lib/ledger/receipt-scan/scan";

export type ReceiptScanResult = Omit<ScanOutcome, "requestId">;

/** 読み取ったレシート（下書きと、証憑として付ける縮めた写真） */
export type ScannedReceipt = { result: ReceiptScanResult; photo: File };

const ENGINE_LABELS: Record<ReceiptEngine, string> = {
  claude: "高精度の読み取り（有料プラン）",
  tesseract: "簡易の読み取り（精度は低め）",
};

const STATUS_KEY = ["receipt-scan-status"];

/** 読み取りと、今日の残り回数（読めなければ status は null）。scan は読み取れなければ、画面に出す文言の Error を投げる */
export function useReceiptScan() {
  const qc = useQueryClient();
  const { data: status, isLoading } = useQuery({
    queryKey: STATUS_KEY,
    queryFn: async (): Promise<ReceiptScanStatus | null> => {
      const res = await fetch("/api/actuals/receipt-scan");
      return res.ok ? (await res.json()).data : null;
    },
  });

  async function scan(file: File): Promise<ScannedReceipt> {
    try {
      const photo = await resizeImageToJpeg(file);
      const body = new FormData();
      body.append("file", photo);
      let res: Response;
      try {
        res = await fetch("/api/actuals/receipt-scan", { method: "POST", body });
      } catch {
        throw new Error("読み取りに失敗しました。通信状態を確かめてください");
      }
      const json = (await res.json().catch(() => ({}))) as {
        data?: ReceiptScanResult;
        error?: string;
      };
      if (!res.ok || !json.data) throw new Error(json.error ?? "読み取りに失敗しました");
      return { result: json.data, photo };
    } finally {
      void qc.invalidateQueries({ queryKey: STATUS_KEY });
    }
  }

  return { status: status ?? null, loading: isLoading, scan };
}

/** タッチで操作する端末か（カメラで撮る「撮影する」を出す） */
export function useCoarsePointer(): boolean {
  const [coarse, setCoarse] = useState(false);
  useEffect(() => setCoarse(window.matchMedia("(pointer: coarse)").matches), []);
  return coarse;
}

/** 「撮影する」（タッチの端末だけ。背面のカメラを開く）と「画像を選ぶ」 */
export function ReceiptPickButtons({
  disabled,
  multiple = false,
  onFiles,
  size = "sm",
}: {
  disabled: boolean;
  /** 画像を選ぶとき、複数枚を選べるようにする */
  multiple?: boolean;
  onFiles: (files: File[]) => void;
  size?: "sm" | "md";
}) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const pickRef = useRef<HTMLInputElement>(null);
  const coarse = useCoarsePointer();
  const text = size === "sm" ? "text-xs" : "text-sm";
  const icon = size === "sm" ? "w-3.5 h-3.5" : "w-4 h-4";
  const handle = (input: HTMLInputElement) => {
    const files = Array.from(input.files ?? []);
    input.value = "";
    if (files.length > 0) onFiles(files);
  };
  return (
    <div className="flex flex-wrap gap-2">
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => handle(e.currentTarget)}
      />
      <input
        ref={pickRef}
        type="file"
        accept="image/*"
        multiple={multiple}
        className="hidden"
        onChange={(e) => handle(e.currentTarget)}
      />
      {coarse && (
        <button
          type="button"
          disabled={disabled}
          onClick={() => cameraRef.current?.click()}
          className={`btn-secondary ${text} inline-flex flex-1 items-center justify-center gap-1.5`}
        >
          <Camera className={icon} aria-hidden />
          撮影する
        </button>
      )}
      <button
        type="button"
        disabled={disabled}
        onClick={() => pickRef.current?.click()}
        className={`btn-secondary ${text} inline-flex flex-1 items-center justify-center gap-1.5`}
      >
        <ImageIcon className={icon} aria-hidden />
        画像を選ぶ
      </button>
    </div>
  );
}

/** 読み取りの種類・今日の残り回数・有料プランの案内・使えない理由 */
export function ScanQuotaNote({ status }: { status: ReceiptScanStatus }) {
  return (
    <div className="flex flex-col gap-0.5 text-[10px]">
      <p className="text-slate-400">
        {ENGINE_LABELS[status.engine]}・今日あと {status.remaining} 回
      </p>
      {status.upgradeAvailable && (
        <Link href={"/settings?tab=billing" as never} className="text-indigo-600 hover:underline">
          有料プランにすると、高精度で読み取れます
        </Link>
      )}
      {status.reason && <p className="text-amber-700">{status.reason}</p>}
    </div>
  );
}

/** カレンダーの「実績を追加」に置く、1 枚ずつの読み取り。読み取った下書きを親のフォームに渡す */
export function ReceiptScanButton({ onScanned }: { onScanned: (r: ScannedReceipt) => void }) {
  const { status, scan } = useReceiptScan();
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState<string | null>(null);

  // 前の写真の表示用 URL を解放する
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function handleFile(file: File) {
    setError("");
    setScanning(true);
    setPreview(URL.createObjectURL(file));
    try {
      onScanned(await scan(file));
    } catch (e) {
      setError(e instanceof Error ? e.message : "読み取りに失敗しました");
    } finally {
      setScanning(false);
    }
  }

  if (!status) return null;

  return (
    <div className="flex flex-col gap-1.5 mb-3">
      <ReceiptPickButtons
        disabled={scanning || status.reason !== null}
        onFiles={([file]) => handleFile(file)}
      />
      {scanning && <p className="text-[10px] text-slate-500">読み取り中…</p>}
      <ScanQuotaNote status={status} />
      {preview && (
        // eslint-disable-next-line @next/next/no-img-element -- 撮ったばかりの写真（blob:）を出すだけ
        <img
          src={preview}
          alt="読み取ったレシート"
          className="max-h-32 w-auto self-start rounded border border-slate-200"
        />
      )}
      {!scanning && preview && !error && (
        <p className="text-[10px] text-emerald-700">
          読み取った内容をフォームに入れました。確かめてから登録してください。
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
