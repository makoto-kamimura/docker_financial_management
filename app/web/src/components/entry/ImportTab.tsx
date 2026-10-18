"use client";

// 実績管理の「取り込み」タブ。現金はレシート・領収書の読み取り（ReceiptImportPanel）、銀行・カードは
// 選んだ口座・カードの明細の CSV（StatementImportPanel）で取り込む。
import { ReceiptImportPanel } from "@/components/entry/ReceiptImportPanel";
import { StatementImportPanel } from "@/components/entry/StatementImportPanel";
import type { ViewMode } from "@/lib/shared/display-name";
import type { Account, Source, SourceAccount } from "@/components/entry/types";

export function ImportTab({
  source,
  account,
  accounts,
  mode,
}: {
  source: Source;
  /** 取り込み先の銀行口座・カード（現金・未選択は null） */
  account: SourceAccount | null;
  /** 科目（現金の登録で使う） */
  accounts: Account[] | undefined;
  mode: ViewMode;
}) {
  if (source === "manual") return <ReceiptImportPanel accounts={accounts} mode={mode} />;
  // 口座を替えたら、前の口座の結果を残さない
  return <StatementImportPanel key={account?.id ?? 0} kind={source} account={account} />;
}
