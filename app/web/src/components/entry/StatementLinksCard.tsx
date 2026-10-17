"use client";

// CSV インポートの「明細を落とすサイト」。選んだ口座・カードの公式サイトを大きく出し、
// その下に登録済みの銀行・カードをすべて並べる（取り込み先の列つき CSV で、まとめて入れるとき用）。
// URL は口座・カードに登録したもの、無ければ金融機関名からの既定（lib/shared/statement-links.ts）。
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { type Source, type SourceAccount } from "@/components/entry/types";
import {
  statementLinkFor,
  type StatementLink,
  type StatementLinkKind,
} from "@/lib/shared/statement-links";

type Item = { kind: StatementLinkKind; account: SourceAccount; link: StatementLink | null };

const MANAGE_PAGE: Record<StatementLinkKind, string> = {
  BANK: "/bank-accounts",
  CARD: "/card-transactions",
};

function toItem(kind: StatementLinkKind, account: SourceAccount): Item {
  const institution = (kind === "BANK" ? account.bankName : account.institution) ?? "";
  return { kind, account, link: statementLinkFor(kind, { ...account, institution }) };
}

/** URL のホスト名（サイト名の無い、登録した URL の表示に使う） */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function StatementLinksCard({
  source,
  selectedId,
  bankAccounts,
  cardAccounts,
}: {
  source: Source;
  /** 選んでいる口座・カード（現金・未選択は null） */
  selectedId: number | null;
  bankAccounts: SourceAccount[] | undefined;
  cardAccounts: SourceAccount[] | undefined;
}) {
  const items = [
    ...(bankAccounts ?? []).map((a) => toItem("BANK", a)),
    ...(cardAccounts ?? []).map((a) => toItem("CARD", a)),
  ];
  if (items.length === 0) return null;
  const selectedKind: StatementLinkKind | null =
    source === "bank" ? "BANK" : source === "card" ? "CARD" : null;
  const selected =
    selectedKind && selectedId !== null
      ? items.find((i) => i.kind === selectedKind && i.account.id === selectedId)
      : undefined;
  const others = items.filter((i) => i !== selected);

  return (
    <div className="card space-y-3">
      <div>
        <p className="text-sm font-medium text-slate-700">明細を落とすサイト</p>
        <p className="text-xs text-slate-500 mt-0.5">
          銀行・カード会社のサイトで明細を CSV で保存し、下の枠に入れます。
        </p>
      </div>

      {selected && <SelectedLink item={selected} />}

      {others.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {others.map((i) => (
            <li key={`${i.kind}${i.account.id}`}>
              {i.link?.url ? (
                <a
                  href={i.link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  title={i.link.siteName ?? hostOf(i.link.url)}
                  className="inline-flex items-center gap-1 rounded-full border border-slate-200 px-3 py-1 text-xs text-indigo-600 hover:bg-indigo-50"
                >
                  {i.account.name}
                  <ExternalLink className="h-3 w-3" aria-hidden />
                </a>
              ) : (
                <span
                  title={i.link?.note ?? "明細ページの URL が未登録です"}
                  className="inline-flex items-center rounded-full border border-dashed border-slate-200 px-3 py-1 text-xs text-slate-400"
                >
                  {i.account.name}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SelectedLink({ item }: { item: Item }) {
  const { kind, account, link } = item;
  if (link?.url) {
    return (
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
    );
  }
  return (
    <div className="rounded-lg border border-dashed border-slate-300 px-4 py-3 text-xs text-slate-500">
      {link?.note ?? (
        <>
          {account.name} の明細ページの URL が未登録です。
          <Link href={MANAGE_PAGE[kind] as never} className="ml-1 text-indigo-600 hover:underline">
            {kind === "BANK" ? "銀行管理" : "カード・電子マネー管理"}の「編集」で登録
          </Link>
        </>
      )}
    </div>
  );
}
