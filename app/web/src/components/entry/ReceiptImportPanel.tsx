"use client";

// 実績管理の取り込み（現金）。レシート・領収書を撮影するか画像を選んで読み取り、確かめて 1 件ずつ登録する。
// 複数枚を選ぶと順番待ちにし、1 枚読み取る → 登録か飛ばす → 次の 1 枚、と進む。今日の読み取りの回数を
// 使い切ったら、そこで止めて残りの枚数を出す。
import { useEffect, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { FileDropzone, Notice } from "@/components/ui";
import { DirectedAmount } from "@/components/DirectedAmount";
import { CashEntryForm } from "@/components/entry/CashEntryForm";
import {
  ReceiptPickButtons,
  ScanQuotaNote,
  useCoarsePointer,
  useReceiptScan,
  type ScannedReceipt,
} from "@/components/entry/ReceiptScanButton";
import type { ViewMode } from "@/lib/shared/display-name";
import type { Account, CashEntry } from "@/components/entry/types";

/** 読み取り中・確かめ中の 1 枚 */
type Current = {
  id: number;
  preview: string;
  file: File;
  receipt: ScannedReceipt | null;
  error: string | null;
};

type Saved = { entry: CashEntry; photoSaved: boolean };

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
  const { status, loading, scan } = useReceiptScan();
  const coarse = useCoarsePointer();
  const [queue, setQueue] = useState<File[]>([]);
  const [current, setCurrent] = useState<Current | null>(null);
  const [date, setDate] = useState(today);
  const [saved, setSaved] = useState<Saved[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const lastId = useRef(0);

  // 次の 1 枚に移ったら、前の画像の表示用 URL を解放する
  const preview = current?.preview;
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  const blocked = status?.reason ?? null;

  async function start(file: File) {
    const id = ++lastId.current;
    setCurrent({ id, preview: URL.createObjectURL(file), file, receipt: null, error: null });
    try {
      const receipt = await scan(file);
      setDate(receipt.result.draft.date ?? today());
      setCurrent((c) => (c?.id === id ? { ...c, receipt } : c));
    } catch (e) {
      const error = e instanceof Error ? e.message : "読み取りに失敗しました";
      setCurrent((c) => (c?.id === id ? { ...c, error } : c));
    }
  }

  /** 次の 1 枚へ（読み取れないときは、順番待ちのまま止める） */
  function advance(rest: File[] = queue) {
    const [next, ...later] = rest;
    if (!next || blocked) {
      setCurrent(null);
      setQueue(rest);
      return;
    }
    setQueue(later);
    void start(next);
  }

  function enqueue(files: File[]) {
    const images = files.filter((f) => f.type.startsWith("image/"));
    setNotice(
      images.length < files.length ? "画像でないファイルは飛ばしました（JPEG・PNG など）" : null,
    );
    if (images.length === 0) return;
    if (current) setQueue((q) => [...q, ...images]);
    else advance([...queue, ...images]);
  }

  const waiting = queue.length;

  return (
    <div className="max-w-3xl space-y-4">
      <div className="card space-y-3">
        <div>
          <p className="text-sm font-medium text-slate-700">① レシート・領収書を読み取る</p>
          <p className="text-xs text-slate-500 mt-0.5">
            撮影するか画像を選ぶと、日付・店名・合計を読み取ります。複数枚を選ぶと、1
            枚ずつ順に確かめて登録します。
          </p>
        </div>
        {status ? (
          <>
            {/* スマホなどはカメラで撮るか写真を選び、パソコンは画像をドロップするか選ぶ */}
            {coarse ? (
              <ReceiptPickButtons
                size="md"
                multiple
                disabled={blocked !== null}
                onFiles={enqueue}
              />
            ) : (
              blocked === null && (
                <FileDropzone
                  busy={false}
                  accept="image/*"
                  multiple
                  hint="レシート・領収書の画像（JPEG・PNG など）。何枚でもまとめて入れられます"
                  onFiles={enqueue}
                />
              )
            )}
            <ScanQuotaNote status={status} />
          </>
        ) : loading ? (
          <p className="text-xs text-slate-400">読み取りの準備をしています…</p>
        ) : (
          <Notice tone="error">
            読み取りの状態を確かめられませんでした。画面を読み込み直してください。
          </Notice>
        )}
        {notice && <Notice tone="warn">{notice}</Notice>}
        {!current && waiting > 0 && (
          <Notice tone="warn">
            <span className="block">
              {blocked ?? "読み取りを止めました。"} 残り {waiting} 枚は読み取っていません。
            </span>
            <span className="mt-2 flex gap-2">
              <button
                type="button"
                disabled={blocked !== null}
                onClick={() => advance()}
                className="btn-secondary text-xs"
              >
                続きを読み取る
              </button>
              <button type="button" onClick={() => setQueue([])} className="btn-secondary text-xs">
                残りを取り消す
              </button>
            </span>
          </Notice>
        )}
      </div>

      {current && (
        <div className="card">
          <p className="text-sm font-medium text-slate-700 mb-3">
            ② 読み取った内容を確かめる
            {waiting > 0 && (
              <span className="ml-2 text-xs font-normal text-slate-500">このあと {waiting} 枚</span>
            )}
          </p>
          <div className="flex flex-col sm:flex-row gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- 選んだばかりの画像（blob:）を出すだけ */}
            <img
              src={current.preview}
              alt="読み取るレシート"
              className="max-h-80 w-full sm:w-56 object-contain self-start rounded border border-slate-200 bg-slate-50"
            />
            <div className="flex-1 min-w-0">
              {current.receipt ? (
                <CashEntryForm
                  key={current.id}
                  accounts={accounts}
                  mode={mode}
                  date={date}
                  onDateChange={setDate}
                  receipt={current.receipt}
                  onSaved={(entry, photoSaved) => {
                    setSaved((s) => [{ entry, photoSaved }, ...s]);
                    advance();
                  }}
                  onSkip={() => advance()}
                />
              ) : current.error ? (
                <div className="space-y-3">
                  <Notice tone="error">{current.error}</Notice>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      disabled={blocked !== null}
                      onClick={() => void start(current.file)}
                      className="btn-secondary text-xs flex-1"
                    >
                      もう一度読み取る
                    </button>
                    <button
                      type="button"
                      onClick={() => advance()}
                      className="btn-secondary text-xs flex-1"
                    >
                      この 1 枚を飛ばす
                    </button>
                  </div>
                </div>
              ) : (
                <p className="flex items-center gap-2 text-sm text-slate-500">
                  <span className="w-4 h-4 border-2 border-slate-300 border-t-indigo-500 rounded-full animate-spin" />
                  読み取り中…
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {saved.length > 0 && (
        <div className="card p-0 overflow-hidden">
          <p className="px-4 pt-3 pb-2 text-sm font-medium text-slate-700">
            ③ 登録した明細（{saved.length} 件）
          </p>
          <ul className="divide-y divide-slate-100">
            {saved.map(({ entry, photoSaved }) => (
              <li key={entry.id} className="flex items-center gap-3 px-4 py-2 text-xs">
                <span className="w-20 shrink-0 tabular-nums text-slate-500">
                  {entry.date.slice(0, 10)}
                </span>
                <span className="flex-1 min-w-0 truncate text-slate-800">
                  {entry.description}
                  {photoSaved ? (
                    <Paperclip
                      className="inline w-3 h-3 ml-1 text-slate-400"
                      aria-label="証憑あり"
                    />
                  ) : (
                    <span className="ml-1 text-amber-700">（写真は保存できませんでした）</span>
                  )}
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
