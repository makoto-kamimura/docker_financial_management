"use client";

// 実績管理の取り込み（現金）。レシート・領収書を撮影するか画像を選ぶと、1 枚ずつすぐ仮の明細として保存し
// （読み取りはサーバーがあとで進める。receipt-drafts.ts）、読み取りが終わったものから確かめて登録する。
// 待たずに何枚でも続けて撮れる。仮は集計に入らない。実績の確定は、その月の仮が残っていると受け付けない。
import { useState } from "react";
import { Paperclip } from "lucide-react";
import { FileDropzone, Notice } from "@/components/ui";
import { DirectedAmount } from "@/components/DirectedAmount";
import { CashEntryForm } from "@/components/entry/CashEntryForm";
import { ReceiptDraftList } from "@/components/entry/ReceiptDraftList";
import {
  ReceiptPickButtons,
  ScanQuotaNote,
  useCoarsePointer,
  useReceiptScan,
} from "@/components/entry/ReceiptScanButton";
import {
  dayLabel,
  saveDraft,
  toDraftReceipt,
  useInvalidateDrafts,
  useReceiptDrafts,
  type ReceiptDraftView,
} from "@/components/entry/receipt-drafts";
import type { ViewMode } from "@/lib/shared/display-name";
import type { Account, CashEntry } from "@/components/entry/types";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export function ReceiptImportPanel({
  accounts,
  mode,
}: {
  accounts: Account[] | undefined;
  mode: ViewMode;
}) {
  const { status, loading } = useReceiptScan();
  const coarse = useCoarsePointer();
  const invalidate = useInvalidateDrafts();
  const { data: drafts = [] } = useReceiptDrafts();
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [notice, setNotice] = useState<{ tone: "warn" | "error"; text: string } | null>(null);
  const [savedCount, setSavedCount] = useState<number | null>(null);
  // フォームを開いている仮と、登録する日
  const [open, setOpen] = useState<ReceiptDraftView | null>(null);
  const [date, setDate] = useState(today);
  const [saved, setSaved] = useState<CashEntry[]>([]);

  const blocked = status?.reason ?? null;

  async function enqueue(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    const skipped = files.length - images.length;
    setNotice(
      skipped > 0
        ? { tone: "warn", text: "画像でないファイルは飛ばしました（JPEG・PNG など）" }
        : null,
    );
    setSavedCount(null);
    if (images.length === 0) return;
    setProgress({ done: 0, total: images.length });
    let ok = 0;
    let lastError = "";
    for (const [i, file] of images.entries()) {
      try {
        await saveDraft(file, today());
        ok++;
      } catch (e) {
        lastError = e instanceof Error ? e.message : "保存に失敗しました";
      }
      setProgress({ done: i + 1, total: images.length });
      invalidate();
    }
    setProgress(null);
    setSavedCount(ok);
    if (ok < images.length) {
      setNotice({
        tone: "error",
        text: `${images.length - ok} 枚を保存できませんでした（${lastError}）`,
      });
    }
  }

  function openDraft(draft: ReceiptDraftView) {
    setOpen(draft);
    // レシートの日付が読めていればその日、読めなければ撮った日
    setDate(draft.result?.draft.date ?? draft.date);
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card space-y-3">
        <div>
          <p className="text-sm font-medium text-slate-700">① レシート・領収書を撮る</p>
          <p className="text-xs text-slate-500 mt-0.5">
            撮影するか画像を選ぶと、すぐ仮の明細として保存します。読み取りはあとで進むので、待たずに続けて撮れます。
            読み取りが終わったものから、下の一覧で確かめて登録してください。
          </p>
        </div>
        {status ? (
          <>
            {/* スマホなどはカメラで撮るか写真を選び、パソコンは画像をドロップするか選ぶ */}
            {coarse ? (
              <ReceiptPickButtons
                size="md"
                multiple
                disabled={blocked !== null || progress !== null}
                onFiles={enqueue}
              />
            ) : (
              blocked === null && (
                <FileDropzone
                  busy={progress !== null}
                  accept="image/*"
                  multiple
                  hint="レシート・領収書の画像（JPEG・PNG など）。何枚でもまとめて入れられます"
                  onFiles={enqueue}
                />
              )
            )}
            <p className="text-[11px] text-slate-600">
              撮った写真は <span className="font-semibold">今日（{dayLabel(today())}）</span>{" "}
              の仮の明細に保存します（レシートの日付が読めたら、登録のときはその日になります）
            </p>
            <ScanQuotaNote status={status} />
          </>
        ) : loading ? (
          <p className="text-xs text-slate-400">読み取りの準備をしています…</p>
        ) : (
          <Notice tone="error">
            読み取りの状態を確かめられませんでした。画面を読み込み直してください。
          </Notice>
        )}
        {progress && (
          <p className="text-xs text-slate-500">
            保存中… {progress.done} / {progress.total} 枚
          </p>
        )}
        {savedCount !== null && savedCount > 0 && (
          <Notice tone="success">
            {savedCount}{" "}
            枚を仮の明細として保存しました。読み取りが終わると、下の一覧に店名と金額が入ります。
          </Notice>
        )}
        {notice && <Notice tone={notice.tone}>{notice.text}</Notice>}
      </div>

      <div className="card space-y-3">
        <p className="text-sm font-medium text-slate-700">
          ② 仮の明細を確かめて登録する
          <span className="ml-2 text-xs font-normal text-slate-500">{drafts.length} 件</span>
        </p>
        {drafts.length === 0 ? (
          <p className="text-xs text-slate-400">仮の明細はありません。</p>
        ) : (
          <ReceiptDraftList drafts={drafts} openId={open?.id ?? null} onOpen={openDraft} />
        )}
        {open && (
          <div className="flex flex-col sm:flex-row gap-4 border-t border-slate-100 pt-3">
            {open.photo && (
              // eslint-disable-next-line @next/next/no-img-element -- 仮の写真（/api/uploads）を出すだけ
              <img
                src={open.photo.fileUrl}
                alt="確かめるレシート"
                className="max-h-80 w-full sm:w-56 object-contain self-start rounded border border-slate-200 bg-slate-50"
              />
            )}
            <div className="flex-1 min-w-0">
              <CashEntryForm
                key={open.id}
                accounts={accounts}
                mode={mode}
                date={date}
                onDateChange={setDate}
                receipt={toDraftReceipt(open)}
                onSaved={(entry) => {
                  setSaved((s) => [entry, ...s]);
                  setOpen(null);
                }}
                onSkip={() => setOpen(null)}
              />
            </div>
          </div>
        )}
      </div>

      {saved.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <p className="px-4 pt-3 pb-2 text-sm font-medium text-slate-700">
            ③ 登録した明細（{saved.length} 件）
          </p>
          <ul className="divide-y divide-slate-100">
            {saved.map((entry) => (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                <span className="w-20 shrink-0 tabular-nums text-slate-500">
                  {entry.date.slice(0, 10)}
                </span>
                <span className="flex-1 min-w-0 truncate text-slate-800">
                  {entry.description}
                  <Paperclip className="inline w-3 h-3 ml-1 text-slate-400" aria-label="証憑あり" />
                </span>
                <DirectedAmount kind="cash" amount={entry.amount} className="font-semibold" />
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
