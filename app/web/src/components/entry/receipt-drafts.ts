"use client";

// 仮の明細（撮ったレシート。/api/actuals/drafts）を画面で扱うフックと操作。
// 撮ったらすぐ仮で保存し、読み取りはサーバーがあとで進める。読み取り中の仮があるあいだは数秒ごとに取り直す。
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { resizeImageToJpeg } from "@/lib/client/resize-image";
import type { ReceiptDraftView } from "@/lib/ledger/receipt-drafts";

export type { ReceiptDraftView };

/** 登録のフォームに入れるレシート（仮の明細から。読み取れていなければ result は null で、手で入力する） */
export type DraftReceipt = { draftId: number; result: ReceiptDraftView["result"] };

export const toDraftReceipt = (d: ReceiptDraftView): DraftReceipt => ({
  draftId: d.id,
  result: d.result,
});

const DRAFTS_KEY = ["receipt-drafts"];
const POLL_MS = 3000;

/** 仮の一覧（年月を渡すと、撮ったときに選んでいた日がその月のもの） */
export function useReceiptDrafts(month?: { year: number; month: number }) {
  return useQuery({
    queryKey: [...DRAFTS_KEY, month?.year ?? null, month?.month ?? null],
    queryFn: async (): Promise<ReceiptDraftView[]> => {
      const q = month ? `?year=${month.year}&month=${month.month}` : "";
      const res = await fetch(`/api/actuals/drafts${q}`);
      return res.ok ? (await res.json()).data : [];
    },
    // 読み取り中の仮があるあいだは取り直す（読み取りが終わったら止める）
    refetchInterval: (query) =>
      (query.state.data ?? []).some((d) => d.status === "READING") ? POLL_MS : false,
  });
}

export function invalidateDrafts(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: DRAFTS_KEY });
  // 読み取りの残り回数・実績の確定の状況（仮の件数）も変わる
  void qc.invalidateQueries({ queryKey: ["receipt-scan-status"] });
  void qc.invalidateQueries({ queryKey: ["cycle-status"] });
}

async function errorOf(res: Response, fallback: string): Promise<Error> {
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return new Error(j.error ?? fallback);
}

/** 写真を縮めて仮で保存する（読み取りは待たない）。縮めた写真も返す */
export async function saveDraft(file: File, date: string): Promise<ReceiptDraftView> {
  const photo = await resizeImageToJpeg(file);
  const body = new FormData();
  body.append("file", photo);
  body.append("date", date);
  let res: Response;
  try {
    res = await fetch("/api/actuals/drafts", { method: "POST", body });
  } catch {
    throw new Error("保存に失敗しました。通信状態を確かめてください");
  }
  if (!res.ok) throw await errorOf(res, "保存に失敗しました");
  return (await res.json()).data;
}

export async function deleteDraft(id: number): Promise<void> {
  const res = await fetch(`/api/actuals/drafts/${id}`, { method: "DELETE" });
  if (!res.ok) throw await errorOf(res, "削除に失敗しました");
}

export async function rereadDraft(id: number): Promise<void> {
  const res = await fetch(`/api/actuals/drafts/${id}/read`, { method: "POST" });
  if (!res.ok) throw await errorOf(res, "読み取り直せませんでした");
}

/** 仮の一覧を取り直すための関数（コンポーネントの中で使う） */
export function useInvalidateDrafts() {
  const qc = useQueryClient();
  return () => invalidateDrafts(qc);
}
