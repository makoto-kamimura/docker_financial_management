"use client";

// 仮の明細（撮ったレシート）の一覧。読み取りの状況（読み取り中・確認待ち・読み取れなかった）と、
// 読み取った店名・金額を「仮」の印を付けて並べる。仮は集計に入らない。
// 「確かめて登録」で登録のフォームを開き、読み取れなかったものは読み取り直すか、手で入力して登録する。
import { useState } from "react";
import { yen } from "@/lib/common/format";
import {
  deleteDraft,
  rereadDraft,
  useInvalidateDrafts,
  type ReceiptDraftView,
} from "@/components/entry/receipt-drafts";

const md = (ymd: string) => {
  const [, m, d] = ymd.split("-").map(Number);
  return `${m}/${d}`;
};

export function ReceiptDraftList({
  drafts,
  openId,
  onOpen,
  showDate = true,
}: {
  drafts: ReceiptDraftView[];
  /** フォームを開いている仮 */
  openId?: number | null;
  onOpen: (draft: ReceiptDraftView) => void;
  /** 日付を出す（カレンダーの日の一覧では出さない） */
  showDate?: boolean;
}) {
  const invalidate = useInvalidateDrafts();
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState("");

  async function run(id: number, action: () => Promise<void>) {
    setBusyId(id);
    setError("");
    try {
      await action();
    } catch (e) {
      setError(e instanceof Error ? e.message : "操作に失敗しました");
    } finally {
      setBusyId(null);
      invalidate();
    }
  }

  if (drafts.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      <ul className="divide-y divide-amber-100 rounded-lg border border-amber-200 bg-amber-50/40">
        {drafts.map((d) => {
          const read = d.result?.draft;
          return (
            <li
              key={d.id}
              className={`flex items-start gap-2 px-2.5 py-2 ${openId === d.id ? "bg-amber-100/60" : ""}`}
            >
              {d.photo ? (
                // eslint-disable-next-line @next/next/no-img-element -- 証憑の写真（/api/uploads）を小さく出すだけ
                <img
                  src={d.photo.fileUrl}
                  alt="撮ったレシート"
                  className="w-10 h-12 object-cover rounded border border-amber-200 bg-white shrink-0"
                />
              ) : null}
              <div className="flex-1 min-w-0">
                <p className="text-xs text-slate-800 truncate">
                  <span className="mr-1.5 rounded bg-amber-500 px-1 py-px text-[10px] font-semibold text-white">
                    仮
                  </span>
                  {showDate && (
                    <span className="mr-1.5 tabular-nums text-slate-500">{md(d.date)}</span>
                  )}
                  {d.status === "READ" && (read?.merchant ?? "店名なし")}
                  {d.status === "READING" && <span className="text-slate-500">読み取り中…</span>}
                  {d.status === "FAILED" && (
                    <span className="text-amber-800">読み取れませんでした</span>
                  )}
                </p>
                {d.status === "READ" && (
                  <p className="text-[10px] text-slate-500 mt-0.5 tabular-nums">
                    {read?.total != null ? yen(read.total) : "金額なし"}
                    {read?.date && read.date !== d.date && `・レシートの日付 ${md(read.date)}`}
                  </p>
                )}
                {d.status === "FAILED" && d.error && (
                  <p className="text-[10px] text-amber-800 mt-0.5">{d.error}</p>
                )}
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px]">
                  {d.status !== "READING" && (
                    <button
                      type="button"
                      onClick={() => onOpen(d)}
                      className="font-medium text-indigo-600 hover:underline"
                    >
                      {d.status === "READ" ? "確かめて登録" : "手で入力して登録"}
                    </button>
                  )}
                  {d.status === "FAILED" && (
                    <button
                      type="button"
                      disabled={busyId === d.id}
                      onClick={() => run(d.id, () => rereadDraft(d.id))}
                      className="text-slate-600 hover:underline disabled:opacity-50"
                    >
                      もう一度読み取る
                    </button>
                  )}
                  <button
                    type="button"
                    disabled={busyId === d.id}
                    onClick={() => {
                      if (window.confirm("この仮の明細と写真を削除します。よろしいですか？")) {
                        void run(d.id, () => deleteDraft(d.id));
                      }
                    }}
                    className="text-slate-400 hover:text-red-500 disabled:opacity-50"
                  >
                    削除
                  </button>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-[10px] text-slate-400">
        仮の明細は集計に入りません。確かめて登録すると実績になります。
      </p>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
