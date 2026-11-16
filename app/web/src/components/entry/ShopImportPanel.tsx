"use client";

// 実績管理の取り込み（出どころ: 明細分け）。明細管理で登録した明細分けに、通販の注文の CSV を取り込む。
// CSV はブラウザで請求ごとにそろえ（lib/shared/shop-order-formats.ts。今は Amazon の公式の注文履歴）、
// 確認（POST /api/shop-orders/import?dryRun=1）のあと取り込む。取り込むと、商品名の学習ルールで科目が付き、
// 金額と日付の合うカード・銀行の明細に自動で紐付く。科目の付かない商品・紐付かない注文は履歴で直す。
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { FileDropzone, Notice } from "@/components/ui";
import { invalidateActuals } from "@/lib/client/invalidate-actuals";
import { yen } from "@/lib/common/format";
import { SHOP_HELP } from "@/lib/shared/help-texts";
import { shopOrderHistoryUrl } from "@/lib/shared/shop-account-type";
import { decodeCsv } from "@/lib/shared/statement-formats";
import {
  chunkCharges,
  convertAmazonOrderHistory,
  type ShopOrderConversion,
} from "@/lib/shared/shop-order-formats";

export type ShopImportAccount = {
  id: number;
  name: string;
  type: string;
  statementUrl?: string | null;
};

type Preview = {
  from: string | null;
  to: string | null;
  fresh: number;
  duplicate: number;
  items: number;
};
type Result = { inserted: number; duplicate: number; linked: number; uncategorizedItems: number };

type Pending = {
  fileName: string;
  conversion: ShopOrderConversion;
  preview: Preview | "loading" | "failed";
};

/** Amazon の「データのリクエスト」のページ（注文履歴の CSV を申し込む） */
const AMAZON_DATA_REQUEST_URL =
  "https://www.amazon.co.jp/hz/privacy-central/data-requests/preview.html";

const UNREADABLE =
  "この CSV は読めませんでした。Amazon の「データのリクエスト」で届く注文履歴の CSV（Order ID・Order Date・Ship Date・Product Name・Total Amount などの列があるもの）を選んでください。";

async function errorOf(res: Response, fallback: string) {
  const j = await res.json().catch(() => null);
  // 入力の誤り（400）は error が文字列でない（項目ごとの誤り）ことがある。
  // サーバーの手前（WAF など）で止められたときは JSON が返らないので、HTTP の状態を添える
  return typeof j?.error === "string" ? j.error : `${fallback}（HTTP ${res.status}）`;
}

export function ShopImportPanel({
  account,
  onShowHistory,
}: {
  /** 取り込み先の明細分け（null は未選択・未登録） */
  account: ShopImportAccount | null;
  /** 取り込んだあと、履歴（出どころ: 明細分け）を開く */
  onShowHistory: (shopAccountId: number) => void;
}) {
  const qc = useQueryClient();
  const [pending, setPending] = useState<Pending | null>(null);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 分けて送っている途中の進み具合（1 回で送れるときは null）
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);

  if (!account) {
    return (
      <div className="max-w-2xl">
        <Notice tone="warn">
          取り込み先の明細分けを選んでください。まだ無ければ、メニューの「明細管理」で登録します。
        </Notice>
      </div>
    );
  }
  const url = shopOrderHistoryUrl(account);

  // 送る前の WAF が本文の大きさ（128KB ほど）で止めるので、請求を 100KB ほどずつに分けて順に送る
  async function postChunks<T>(
    conversion: ShopOrderConversion,
    dryRun: boolean,
    fallback: string,
  ): Promise<T[] | null> {
    const results: T[] = [];
    const chunks = chunkCharges(conversion.charges);
    for (const [i, charges] of chunks.entries()) {
      if (chunks.length > 1) setProgress({ done: i, total: chunks.length });
      const res = await fetch(
        `/api/shop-orders/import?shopAccountId=${account!.id}${dryRun ? "&dryRun=1" : ""}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ charges }),
        },
      );
      if (!res.ok) {
        const message = await errorOf(res, fallback);
        setError(
          i > 0 && !dryRun
            ? `${message}（${chunks.length} 回に分けて送ったうちの ${i} 回目までは取り込みました。同じ CSV をもう一度入れると、残りだけを取り込みます）`
            : message,
        );
        return null;
      }
      const json = await res.json();
      results.push((dryRun ? json.preview : json.result) as T);
    }
    setProgress(null);
    return results;
  }

  async function readFile(file: File) {
    setError(null);
    setResult(null);
    const text = decodeCsv(new Uint8Array(await file.arrayBuffer()));
    const conversion = convertAmazonOrderHistory(text);
    if (!conversion) {
      setPending(null);
      setError(UNREADABLE);
      return;
    }
    if (conversion.charges.length === 0) {
      setPending(null);
      setError("取り込める注文がありませんでした（取り消し・未発送の注文だけでした）。");
      return;
    }
    const next: Pending = { fileName: file.name, conversion, preview: "loading" };
    setPending(next);
    try {
      const previews = await postChunks<Preview>(
        conversion,
        true,
        "取り込む前の確認に失敗しました",
      );
      if (!previews) {
        setPending({ ...next, preview: "failed" });
        return;
      }
      const dates = previews.flatMap((p) => [p.from, p.to]).filter((d): d is string => !!d);
      dates.sort();
      setPending({
        ...next,
        preview: {
          from: dates[0] ?? null,
          to: dates.at(-1) ?? null,
          fresh: previews.reduce((n, p) => n + p.fresh, 0),
          duplicate: previews.reduce((n, p) => n + p.duplicate, 0),
          items: previews.reduce((n, p) => n + p.items, 0),
        },
      });
    } catch {
      setError("通信に失敗しました。時間をおいてもう一度試してください。");
      setPending({ ...next, preview: "failed" });
    } finally {
      setProgress(null);
    }
  }

  async function confirmImport(p: Pending) {
    setImporting(true);
    setError(null);
    try {
      const results = await postChunks<Result>(p.conversion, false, "取り込みに失敗しました");
      if (results) {
        setResult({
          inserted: results.reduce((n, r) => n + r.inserted, 0),
          duplicate: results.reduce((n, r) => n + r.duplicate, 0),
          linked: results.reduce((n, r) => n + r.linked, 0),
          uncategorizedItems: results.reduce((n, r) => n + r.uncategorizedItems, 0),
        });
        setPending(null);
      }
      for (const key of [
        "shop-orders",
        "shop-accounts",
        "card-txns",
        "bank-txns",
        "ledger-unassigned",
      ]) {
        qc.invalidateQueries({ queryKey: [key] });
      }
      invalidateActuals(qc);
    } catch {
      setError("通信に失敗しました。時間をおいてもう一度試してください。");
    } finally {
      setImporting(false);
      setProgress(null);
    }
  }

  const c = pending?.conversion;
  const itemCount = c ? c.charges.reduce((n, x) => n + x.items.length, 0) : 0;
  const total = c ? c.charges.reduce((n, x) => n + x.amount, 0) : 0;

  return (
    <div className="max-w-2xl space-y-4">
      <div className="card space-y-2">
        <p className="text-sm font-medium text-slate-700">① 注文履歴の CSV を用意する</p>
        <p className="text-xs text-slate-500 leading-relaxed">{SHOP_HELP.amazonCsv}</p>
        <div className="flex flex-wrap gap-4">
          {account.type === "AMAZON" && (
            <a
              href={AMAZON_DATA_REQUEST_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-600 hover:underline"
            >
              Amazon のデータのリクエストを開く
            </a>
          )}
          {url && (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-indigo-600 hover:underline"
            >
              {account.name} の注文履歴を開く
            </a>
          )}
        </div>
      </div>

      <div className="card space-y-3">
        <div>
          <p className="text-sm font-medium text-slate-700">② CSV を入れる（{account.name}）</p>
          <p className="text-xs text-slate-500 mt-0.5">{SHOP_HELP.importNote}</p>
        </div>
        <FileDropzone
          busy={importing}
          busyLabel="取り込み中…"
          onFiles={([f]) => void readFile(f)}
        />
      </div>

      {error && <Notice tone="error">{error}</Notice>}
      {progress && (
        <p className="text-xs text-slate-500">
          {progress.total} 回に分けて送っています（{progress.done + 1} 回目）…
        </p>
      )}

      {result && (
        <div className="card border border-green-200 bg-green-50 space-y-2">
          <p className="text-sm text-slate-800">
            ✅ 注文の請求を {result.inserted.toLocaleString()} 件取り込みました
            {result.duplicate > 0 && `（${result.duplicate.toLocaleString()} 件は取り込み済み）`}。
            {result.linked > 0
              ? ` ${result.linked.toLocaleString()} 件をカード・銀行の明細に自動で紐付けました。`
              : ""}
          </p>
          {(result.uncategorizedItems > 0 || result.inserted > result.linked) && (
            <p className="text-sm text-slate-700">
              {result.uncategorizedItems > 0 &&
                `科目の付いていない商品が ${result.uncategorizedItems.toLocaleString()} 件あります。`}
              {result.inserted > result.linked &&
                `明細に紐付いていない請求が ${(result.inserted - result.linked).toLocaleString()} 件あります。`}
            </p>
          )}
          <button
            type="button"
            onClick={() => onShowHistory(account.id)}
            className="btn-secondary text-xs"
          >
            履歴で科目と紐付けを確かめる
          </button>
        </div>
      )}

      {pending && c && (
        <div className="card space-y-3">
          <div>
            <p className="text-sm font-medium text-slate-700">③ 中身を確かめて取り込む</p>
            <p className="text-xs text-slate-500 mt-0.5">
              {pending.fileName}（{c.format}）
            </p>
          </div>
          <ul className="text-sm text-slate-700 space-y-1">
            <li>
              請求 {c.charges.length.toLocaleString()} 件・商品 {itemCount.toLocaleString()}{" "}
              件・合計 {yen(total)}
            </li>
            {pending.preview === "loading" ? (
              <li className="text-slate-400">取り込み済みかを確かめています…</li>
            ) : pending.preview === "failed" ? (
              <li className="text-amber-700">取り込み済みかを確かめられませんでした</li>
            ) : (
              <>
                <li>
                  期間: {pending.preview.from?.replaceAll("-", "/")} 〜{" "}
                  {pending.preview.to?.replaceAll("-", "/")}
                </li>
                <li>
                  新しく入る請求 {pending.preview.fresh.toLocaleString()} 件
                  {pending.preview.duplicate > 0 &&
                    `（${pending.preview.duplicate.toLocaleString()} 件は取り込み済みなので飛ばします）`}
                </li>
              </>
            )}
            {c.skipped.length > 0 && (
              <li className="text-xs text-slate-500">
                読まなかった行:{" "}
                {c.skipped.map((s) => `${s.reason} ${s.count.toLocaleString()} 行`).join("・")}
              </li>
            )}
          </ul>
          <div className="max-h-56 overflow-y-auto border border-slate-100 rounded">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-50 text-slate-600">
                  <th className="px-2 py-1 text-left font-semibold">請求日</th>
                  <th className="px-2 py-1 text-left font-semibold">注文番号</th>
                  <th className="px-2 py-1 text-left font-semibold">商品</th>
                  <th className="px-2 py-1 text-right font-semibold">金額</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {c.charges
                  .slice(-50)
                  .reverse()
                  .map((x) => (
                    <tr key={x.key}>
                      <td className="px-2 py-1 whitespace-nowrap tabular-nums">
                        {x.date.replaceAll("-", "/")}
                      </td>
                      <td className="px-2 py-1 whitespace-nowrap">{x.orderNo}</td>
                      <td className="px-2 py-1">
                        {x.items[0].name}
                        {x.items.length > 1 && (
                          <span className="text-slate-400"> ほか {x.items.length - 1} 件</span>
                        )}
                      </td>
                      <td className="px-2 py-1 text-right whitespace-nowrap tabular-nums">
                        {yen(x.amount)}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          {c.charges.length > 50 && (
            <p className="text-[11px] text-slate-400">新しい 50 件だけを表示しています。</p>
          )}
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setPending(null)}
              className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
            >
              やめる
            </button>
            <button
              type="button"
              disabled={
                importing ||
                pending.preview === "loading" ||
                (pending.preview !== "failed" && pending.preview.fresh === 0)
              }
              onClick={() => void confirmImport(pending)}
              className="btn-primary"
            >
              取り込む
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
