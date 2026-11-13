"use client";

// 現金の明細の入力で使う、レシート・領収書の撮影。撮った写真・選んだ画像は、すぐ仮の明細として保存し
// （receipt-drafts.ts）、読み取りはサーバーがあとで進める。読み取りが終わったら、仮の一覧から確かめて登録する。
// 有料プランは高精度（Claude）、無料プランは簡易（サーバーの中の OCR）で読む。
//   - useReceiptScan … 読み取りの種類と、今日の残り回数
//   - ReceiptPickButtons … 「撮影する」（スマホなどのカメラ）と「画像を選ぶ」
//   - ScanQuotaNote … 読み取りの種類・残り回数・プランの案内
//   - ReceiptScanButton … カレンダーの「実績を追加」に置く、仮で保存するボタン

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { Camera, ImageIcon } from "lucide-react";
import type { ReceiptEngine } from "@/lib/ledger/receipt-scan/types";
import type { ReceiptScanStatus } from "@/lib/ledger/receipt-scan/scan";
import { saveDraft, useInvalidateDrafts } from "@/components/entry/receipt-drafts";

const ENGINE_LABELS: Record<ReceiptEngine, string> = {
  claude: "高精度の読み取り（有料プラン）",
  tesseract: "簡易の読み取り（精度は低め）",
};

/** 読み取りの種類と、今日の残り回数（読めなければ status は null） */
export function useReceiptScan() {
  const { data: status, isLoading } = useQuery({
    queryKey: ["receipt-scan-status"],
    queryFn: async (): Promise<ReceiptScanStatus | null> => {
      const res = await fetch("/api/actuals/receipt-scan");
      return res.ok ? (await res.json()).data : null;
    },
  });
  return { status: status ?? null, loading: isLoading };
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

/**
 * カレンダーの「実績を追加」に置く、撮ったレシートを仮で保存するボタン。選んでいる日で仮を作り、
 * 読み取りはあとで進める（終わると、カレンダーの仮の明細に店名と金額が入る）
 */
export function ReceiptScanButton({ date }: { date: string }) {
  const { status } = useReceiptScan();
  const invalidate = useInvalidateDrafts();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  async function handleFile(file: File) {
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      await saveDraft(file, date);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "保存に失敗しました");
    } finally {
      setSaving(false);
      invalidate();
    }
  }

  if (!status) return null;

  return (
    <div className="flex flex-col gap-1.5 mb-3">
      <ReceiptPickButtons
        disabled={saving || status.reason !== null}
        onFiles={([file]) => handleFile(file)}
      />
      {saving && <p className="text-[10px] text-slate-500">保存中…</p>}
      <ScanQuotaNote status={status} />
      {saved && !error && (
        <p className="text-[10px] text-emerald-700">
          仮の明細として保存しました。読み取りが終わると、上の「仮の明細」に店名と金額が入ります。
          確かめてから登録してください（続けて撮れます）。
        </p>
      )}
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
