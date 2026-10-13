"use client";

// 個人事業主モードの総勘定元帳と試算表。実績から作った仕訳をまとめたもの
// （GET /api/reports/general-ledger・/api/reports/trial-balance の scope=business）。見るだけ。
// 普通預金・預け金は口座・カードごとの補助科目に分かれる。印刷はブラウザの印刷。

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { PageHeader, Tabs } from "@/components/ui";
import { EmptyState, LoadingSpinner } from "@/components/StateViews";
import {
  bookAccountLabel,
  PrintButton,
  type BookAccountView,
} from "@/components/books/AutoJournalBook";
import { useFiscalYear } from "@/lib/client/use-fiscal-year";
import { BOOKS_HELP } from "@/lib/shared/help-texts";
import { yen } from "@/lib/common/format";

type Account = BookAccountView & { category: string };
type Ledger = {
  account: Account;
  rows: {
    date: string;
    no: number;
    description: string;
    debit: number;
    credit: number;
    balance: number;
  }[];
  totalDebit: number;
  totalCredit: number;
  balance: number;
};
type TrialBalance = {
  rows: { account: Account; debit: number; credit: number; balance: number }[];
  totalDebit: number;
  totalCredit: number;
  income: number;
};

const CATEGORY_LABEL: Record<string, string> = {
  ASSET: "資産",
  LIABILITY: "負債",
  CAPITAL: "資本",
  REVENUE: "収入",
  COGS: "原価",
  EXPENSE: "経費",
  PROFIT: "貯蓄",
  OTHER: "その他",
};

const amountCell = (v: number) => (v === 0 ? "—" : yen(v));

export function AutoLedgerBook() {
  const year = useFiscalYear();
  const [tab, setTab] = useState<"ledger" | "trial">("ledger");
  const [accountKey, setAccountKey] = useState("");

  const { data: ledgers, isLoading } = useQuery({
    queryKey: ["auto-ledger", year],
    queryFn: async (): Promise<Ledger[]> =>
      (await (await fetch(`/api/reports/general-ledger?year=${year}&scope=business`)).json())
        .data ?? [],
  });
  const { data: trial, isLoading: trialLoading } = useQuery({
    queryKey: ["auto-trial-balance", year],
    queryFn: async (): Promise<TrialBalance> =>
      (await (await fetch(`/api/reports/trial-balance?year=${year}&scope=business`)).json()).data,
    enabled: tab === "trial",
  });

  const shown = (ledgers ?? []).filter((l) => !accountKey || l.account.key === accountKey);
  const csvUrl =
    tab === "ledger"
      ? `/api/reports/general-ledger?year=${year}&scope=business&format=csv`
      : `/api/reports/trial-balance?year=${year}&scope=business&format=csv`;

  return (
    <>
      <PageHeader
        title="総勘定元帳"
        lead={tab === "ledger" ? BOOKS_HELP.ledger : BOOKS_HELP.trialBalance}
        showYear
        actions={
          <>
            <a href={csvUrl} className="btn-secondary print:hidden">
              CSV ダウンロード
            </a>
            <PrintButton />
          </>
        }
      />
      <div className="print:hidden">
        <Tabs
          tabs={[
            ["ledger", "総勘定元帳"],
            ["trial", "試算表"],
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>

      {tab === "ledger" && (
        <>
          <div className="flex items-center gap-2 mb-4 print:hidden">
            <label htmlFor="auto-ledger-account" className="text-xs font-medium text-slate-600">
              勘定科目
            </label>
            <select
              id="auto-ledger-account"
              value={accountKey}
              onChange={(e) => setAccountKey(e.target.value)}
              className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white max-w-72"
            >
              <option value="">すべての科目</option>
              {(ledgers ?? []).map((l) => (
                <option key={l.account.key} value={l.account.key}>
                  {l.account.code} {bookAccountLabel(l.account)}
                </option>
              ))}
            </select>
          </div>
          {isLoading ? (
            <LoadingSpinner />
          ) : shown.length === 0 ? (
            <EmptyState title="この年度の仕訳はありません" description={BOOKS_HELP.empty} />
          ) : (
            shown.map((l) => (
              <section
                key={l.account.key}
                className="card p-0 mb-4 overflow-hidden break-inside-avoid-page"
              >
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 flex flex-wrap justify-between gap-2">
                  <h2 className="font-semibold text-slate-800">
                    {l.account.code} {bookAccountLabel(l.account)}
                  </h2>
                  <p className="text-xs text-slate-500 space-x-3 tabular-nums">
                    <span>借方合計 {yen(l.totalDebit)}</span>
                    <span>貸方合計 {yen(l.totalCredit)}</span>
                    <span className="font-semibold text-slate-700">残高 {yen(l.balance)}</span>
                  </p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs text-slate-500 border-b border-slate-100">
                      <tr>
                        <th className="px-4 py-2 text-left font-medium whitespace-nowrap">日付</th>
                        <th className="px-4 py-2 text-right font-medium">番号</th>
                        <th className="px-4 py-2 text-left font-medium">摘要</th>
                        <th className="px-4 py-2 text-right font-medium">借方</th>
                        <th className="px-4 py-2 text-right font-medium">貸方</th>
                        <th className="px-4 py-2 text-right font-medium">残高</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {l.rows.map((r, i) => (
                        <tr key={i}>
                          <td className="px-4 py-1.5 whitespace-nowrap tabular-nums">{r.date}</td>
                          <td className="px-4 py-1.5 text-right text-xs text-slate-400">{r.no}</td>
                          <td className="px-4 py-1.5 text-slate-600">{r.description}</td>
                          <td className="px-4 py-1.5 text-right tabular-nums">
                            {amountCell(r.debit)}
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums">
                            {amountCell(r.credit)}
                          </td>
                          <td className="px-4 py-1.5 text-right tabular-nums">{yen(r.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))
          )}
        </>
      )}

      {tab === "trial" &&
        (trialLoading || !trial ? (
          <LoadingSpinner />
        ) : trial.rows.length === 0 ? (
          <EmptyState title="この年度の仕訳はありません" description={BOOKS_HELP.empty} />
        ) : (
          <section className="card p-0 overflow-x-auto">
            <h2 className="sr-only">試算表</h2>
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
                <tr>
                  <th className="px-4 py-2 text-left font-medium">勘定科目</th>
                  <th className="px-4 py-2 text-left font-medium">区分</th>
                  <th className="px-4 py-2 text-right font-medium">借方合計</th>
                  <th className="px-4 py-2 text-right font-medium">貸方合計</th>
                  <th className="px-4 py-2 text-right font-medium">残高</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {trial.rows.map((r) => (
                  <tr key={r.account.key}>
                    <td className="px-4 py-1.5">
                      <span className="text-xs text-slate-400 mr-1.5">{r.account.code}</span>
                      {bookAccountLabel(r.account)}
                    </td>
                    <td className="px-4 py-1.5 text-xs text-slate-500">
                      {CATEGORY_LABEL[r.account.category] ?? r.account.category}
                    </td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{amountCell(r.debit)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{amountCell(r.credit)}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{yen(r.balance)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t border-slate-200 font-semibold tabular-nums">
                <tr>
                  <td className="px-4 py-2" colSpan={2}>
                    合計
                  </td>
                  <td className="px-4 py-2 text-right">{yen(trial.totalDebit)}</td>
                  <td className="px-4 py-2 text-right">{yen(trial.totalCredit)}</td>
                  <td />
                </tr>
                <tr>
                  <td className="px-4 py-2" colSpan={4}>
                    所得（収入 − 原価 − 経費）
                  </td>
                  <td className="px-4 py-2 text-right">{yen(trial.income)}</td>
                </tr>
              </tfoot>
            </table>
          </section>
        ))}
    </>
  );
}
