"use client";

// 個人事業主モードの仕訳帳。実績から作った仕訳（GET /api/journals/auto）を見せるだけで、入力・承認・証憑の操作は出さない。
// 作り方は lib/accounting/auto-journal.ts。印刷はブラウザの印刷（メニューや操作のボタンは印刷しない）。

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Printer } from "lucide-react";
import { PageHeader } from "@/components/ui";
import { InfoNote } from "@/components/Explain";
import { EmptyState, LoadingSpinner } from "@/components/StateViews";
import { useFiscalYear } from "@/lib/client/use-fiscal-year";
import { BOOKS_HELP } from "@/lib/shared/help-texts";
import { yen } from "@/lib/common/format";

export type BookAccountView = { key: string; code: string; name: string; sub: string | null };
type Line = { key: string; side: "debit" | "credit"; amount: number; account: BookAccountView };
type Journal = { no: number; date: string; description: string; lines: Line[] };
type Response = {
  data: Journal[];
  total: number;
  skippedJournals: { id: number; date: string; description: string }[];
};

export const bookAccountLabel = (a: BookAccountView) => (a.sub ? `${a.name}（${a.sub}）` : a.name);

export function SkippedJournalsNote({ skipped }: { skipped: Response["skippedJournals"] }) {
  if (skipped.length === 0) return null;
  return (
    <div className="print:hidden">
      <InfoNote title={`含めていない仕訳が ${skipped.length} 件あります`}>
        {BOOKS_HELP.skipped}
        <details className="mt-1">
          <summary className="cursor-pointer text-indigo-600">一覧を見る</summary>
          <ul className="mt-1 list-disc pl-5">
            {skipped.map((j) => (
              <li key={j.id}>
                {j.date} {j.description}
              </li>
            ))}
          </ul>
        </details>
      </InfoNote>
    </div>
  );
}

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="btn-secondary inline-flex items-center gap-1.5 print:hidden"
    >
      <Printer className="w-4 h-4" aria-hidden="true" />
      印刷
    </button>
  );
}

export function AutoJournalBook() {
  const year = useFiscalYear();
  // 0 = 年度のすべての月
  const [month, setMonth] = useState(new Date().getMonth() + 1);

  const { data, isLoading } = useQuery({
    queryKey: ["auto-journals", year, month],
    queryFn: async (): Promise<Response> =>
      (await fetch(`/api/journals/auto?year=${year}${month ? `&month=${month}` : ""}`)).json(),
  });
  const journals = data?.data ?? [];

  return (
    <>
      <PageHeader title="仕訳帳" lead={BOOKS_HELP.journal} showYear actions={<PrintButton />} />

      <div className="flex items-center gap-3 mb-4 print:hidden">
        <label htmlFor="auto-journal-month" className="text-xs font-medium text-slate-600">
          月
        </label>
        <select
          id="auto-journal-month"
          className="text-xs border border-slate-300 rounded-md px-2 py-1.5 bg-white"
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
        >
          <option value={0}>すべての月</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>
              {m}月
            </option>
          ))}
        </select>
        <span className="text-xs text-slate-400">{data?.total ?? 0}件</span>
      </div>
      <p className="hidden print:block text-sm mb-2">
        {year}年{month ? `${month}月` : ""}
      </p>

      {data && <SkippedJournalsNote skipped={data.skippedJournals} />}

      {isLoading ? (
        <LoadingSpinner />
      ) : journals.length === 0 ? (
        <EmptyState title="この月の仕訳はありません" description={BOOKS_HELP.empty} />
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 border-b border-slate-200">
              <tr>
                <th className="px-3 py-2 text-right font-medium w-12">番号</th>
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">日付</th>
                <th className="px-3 py-2 text-left font-medium">借方</th>
                <th className="px-3 py-2 text-right font-medium">金額</th>
                <th className="px-3 py-2 text-left font-medium">貸方</th>
                <th className="px-3 py-2 text-right font-medium">金額</th>
                <th className="px-3 py-2 text-left font-medium">摘要</th>
              </tr>
            </thead>
            <tbody>
              {journals.map((j) => {
                const debits = j.lines.filter((l) => l.side === "debit");
                const credits = j.lines.filter((l) => l.side === "credit");
                const rows = Math.max(debits.length, credits.length);
                return Array.from({ length: rows }, (_, i) => (
                  <tr
                    key={`${j.no}-${i}`}
                    className={`break-inside-avoid ${i === rows - 1 ? "border-b border-slate-100" : ""}`}
                  >
                    {i === 0 && (
                      <>
                        <td
                          rowSpan={rows}
                          className="px-3 py-1.5 text-right text-xs text-slate-400 align-top"
                        >
                          {j.no}
                        </td>
                        <td
                          rowSpan={rows}
                          className="px-3 py-1.5 whitespace-nowrap align-top tabular-nums"
                        >
                          {j.date}
                        </td>
                      </>
                    )}
                    <td className="px-3 py-1.5">
                      {debits[i] ? bookAccountLabel(debits[i].account) : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {debits[i] ? yen(debits[i].amount) : ""}
                    </td>
                    <td className="px-3 py-1.5">
                      {credits[i] ? bookAccountLabel(credits[i].account) : ""}
                    </td>
                    <td className="px-3 py-1.5 text-right tabular-nums">
                      {credits[i] ? yen(credits[i].amount) : ""}
                    </td>
                    {i === 0 && (
                      <td rowSpan={rows} className="px-3 py-1.5 text-slate-600 align-top">
                        {j.description}
                      </td>
                    )}
                  </tr>
                ));
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
