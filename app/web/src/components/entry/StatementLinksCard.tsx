"use client";

// 実績管理の取り込み（銀行・カード）の「① 明細を落とす」。選んだ口座・カードの明細を見る公式サイトを開き、
// 前回どこまで取り込んだか（GET /api/imports/coverage）から、次に落とす期間の目安を出す。
// URL は口座・カードに登録したもの、無ければ金融機関名からの既定（lib/shared/statement-links.ts）。
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { type SourceAccount } from "@/components/entry/types";
import { statementLinkFor, type StatementLinkKind } from "@/lib/shared/statement-links";

const MANAGE_PAGE: Record<StatementLinkKind, string> = {
  BANK: "/bank-accounts",
  CARD: "/card-transactions",
};

/** URL のホスト名（サイト名の無い、登録した URL の表示に使う） */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function StatementLinksCard({
  kind,
  account,
  lastDate,
}: {
  kind: StatementLinkKind;
  account: SourceAccount;
  /** CSV・自動取得で入った明細のいちばん新しい日付（まだ無ければ null、読み込み中は undefined） */
  lastDate: string | null | undefined;
}) {
  const institution = (kind === "BANK" ? account.bankName : account.institution) ?? "";
  const link = statementLinkFor(kind, { ...account, institution });

  return (
    <div className="card space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-700">① 明細を落とす</p>
        <p className="text-xs text-slate-500 mt-0.5">
          {kind === "BANK" ? "銀行" : "カード会社・電子マネー"}
          のサイトで明細を CSV
          で保存します。前回と期間が重なってもかまいません（同じ明細は二重に入りません）。
        </p>
        {lastDate !== undefined && (
          <p className="mt-1 text-xs text-slate-700">
            {lastDate
              ? `前回は ${lastDate} の明細まで取り込み済みです。その日から今日までの明細を保存してください。`
              : kind === "BANK"
                ? "まだ明細を取り込んでいません。取り込む前の確認で、残高が合う差額（期首残高）の目安を出します。"
                : "まだ明細を取り込んでいません。"}
          </p>
        )}
      </div>
      {link?.url ? (
        <a
          href={link.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-lg border border-indigo-200 bg-indigo-50 px-4 py-3 hover:bg-indigo-100"
        >
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-indigo-700">
              {account.name} の明細を開く
            </span>
            <span className="block truncate text-xs text-indigo-500">
              {link.siteName ?? hostOf(link.url)}
            </span>
          </span>
          <ExternalLink className="h-4 w-4 shrink-0 text-indigo-500" aria-hidden />
        </a>
      ) : (
        <div className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-xs text-slate-500">
          {link?.note ?? (
            <>
              {account.name} の明細ページの URL が未登録です。
              <Link
                href={MANAGE_PAGE[kind] as never}
                className="ml-1 text-indigo-600 hover:underline"
              >
                {kind === "BANK" ? "銀行管理" : "カード・電子マネー管理"}の「編集」で登録
              </Link>
            </>
          )}
        </div>
      )}
    </div>
  );
}
