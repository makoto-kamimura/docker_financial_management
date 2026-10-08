"use client";

// 実績管理の「一覧」タブ。科目×月の実績の表（見るだけ）と、セルを押したときの内訳。
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { Modal } from "@/components/Modal";
import { EmptyState, LoadingSpinner } from "@/components/StateViews";
import { AccountMonthMatrix, type MatrixCell } from "@/components/AccountMonthMatrix";
import { useFiscalYear } from "@/lib/use-fiscal-year";
import { ENTRY_HELP } from "@/lib/help-texts";
import { displayName, type ViewMode } from "@/lib/display-name";
import { buildFinancialMatrix, type MatrixRecord } from "@/lib/financial-matrix";
import { categoryRank } from "@/lib/labels";
import { yen } from "@/lib/format";
import { type Account } from "@/components/entry/types";

// 実績 1 行の出どころ（GET /api/financials/matrix）。セルの内訳モーダルで表示する
type RecordSource = {
  kind: "cash" | "bank" | "card" | "journal" | "direct";
  date: string | null;
  description: string | null;
  accountName: string | null;
};
type MatrixEntry = MatrixRecord & {
  journalEntryId: number | null;
  createdAt: string;
  source: RecordSource;
};
type MatrixResponse = {
  year: number;
  data: MatrixEntry[];
  years: number[];
  /** 実績を確定済みの月 */
  confirmedMonths: number[];
};

// セル内訳モーダルに出す「どこから入った実績か」のラベル
const SOURCE_LABEL: Record<RecordSource["kind"], string> = {
  cash: "現金の明細",
  bank: "銀行の明細",
  card: "カードの明細",
  journal: "仕訳と連動",
  direct: "過去の直接入力",
};
const SOURCE_BADGE: Record<RecordSource["kind"], string> = {
  cash: "bg-emerald-50 text-emerald-700",
  bank: "bg-sky-50 text-sky-700",
  card: "bg-violet-50 text-violet-700",
  journal: "bg-amber-50 text-amber-700",
  direct: "bg-slate-100 text-slate-600",
};
const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, "0")}/${String(d.getDate()).padStart(2, "0")} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export function ActualsMatrixTab({
  accounts,
  mode,
}: {
  accounts: Account[] | undefined;
  mode: ViewMode;
}) {
  // 対象年度は左のメニューで選ぶ（全画面で共通）
  const matrixYear = useFiscalYear();
  // 「◯件」を押して開くセル内訳モーダル（同じ科目・月に複数の実績があるセル）
  const [cellDetail, setCellDetail] = useState<{ accountCode: string; month: number } | null>(null);

  const { data: matrixData, isLoading: matrixLoading } = useQuery({
    queryKey: ["financials-matrix", matrixYear],
    queryFn: async (): Promise<MatrixResponse> => {
      const url = matrixYear
        ? `/api/financials/matrix?year=${matrixYear}`
        : "/api/financials/matrix";
      return (await fetch(url)).json();
    },
    placeholderData: (prev) => prev,
  });
  const matrixCurrentYear = matrixYear;

  // 科目 × 月へ組み替え、予算管理と同じカテゴリ順（資産→負債→収入→…）で並べる
  const matrixRows = useMemo(() => {
    const rows = buildFinancialMatrix(matrixData?.data ?? []);
    return rows.sort(
      (a, b) =>
        categoryRank(a.account.category) - categoryRank(b.account.category) ||
        a.account.code.localeCompare(b.account.code),
    );
  }, [matrixData]);

  // 内訳モーダルの対象セル。削除で 0 件になったセルは detailCell が null になる
  const detailCell = useMemo(() => {
    if (!cellDetail) return null;
    const row = matrixRows.find((r) => r.account.code === cellDetail.accountCode);
    return row?.byMonth.get(cellDetail.month) ?? null;
  }, [cellDetail, matrixRows]);
  const detailAccount = cellDetail
    ? (matrixRows.find((r) => r.account.code === cellDetail.accountCode)?.account ?? null)
    : null;

  // 一覧のセル（見るだけ）。実績は明細に科目を付けると入るので、ここでは直接変えない。
  // セルを押すと、どの明細・仕訳から入った実績かの内訳を出す
  function entryCell(code: string, m: number): MatrixCell | null {
    const cell = matrixRows.find((r) => r.account.code === code)?.byMonth.get(m);
    if (!cell) return null;
    return {
      amount: cell.total,
      editable: null,
      action:
        cell.records.length > 0 ? (
          <button
            type="button"
            onClick={() => setCellDetail({ accountCode: code, month: m })}
            title="この月の実績の内訳を表示"
            className="text-[10px] text-indigo-500 hover:text-indigo-700 underline underline-offset-2 whitespace-nowrap"
          >
            {cell.records.length}件
          </button>
        ) : undefined,
    };
  }

  if (matrixLoading && !matrixData) return <LoadingSpinner label="実績を読み込み中…" />;

  return (
    <>
      {matrixRows.length === 0 && (
        <EmptyState
          title="実績データがありません"
          description={`${matrixCurrentYear}年の実績がありません。明細（現金・銀行・カード）をカレンダーか CSV インポートで入れ、科目を付けると実績になります。`}
        />
      )}
      <AccountMonthMatrix
        mode={mode}
        year={matrixCurrentYear}
        noun="実績"
        rows={matrixRows.map((r) => accounts?.find((a) => a.code === r.account.code) ?? r.account)}
        allAccounts={accounts ?? []}
        getCell={entryCell}
        lockedMonths={new Set(matrixData?.confirmedMonths ?? [])}
        lockedTitle={(m) => `${m}月の実績は確定済みです。${ENTRY_HELP.actualsLocked}`}
      />

      {cellDetail && (
        <Modal size="xl">
          <div className="flex items-start justify-between gap-4 mb-1">
            <h2 className="text-lg font-bold text-slate-800">
              {detailAccount
                ? displayName(
                    accounts?.find((a) => a.code === detailAccount.code) ?? detailAccount,
                    mode,
                  )
                : "実績の内訳"}
              <span className="ml-2 text-sm font-normal text-slate-500">
                {matrixCurrentYear}年{cellDetail.month}月
              </span>
            </h2>
            <button
              type="button"
              onClick={() => setCellDetail(null)}
              className="text-sm text-slate-400 hover:text-slate-600"
            >
              閉じる
            </button>
          </div>
          <p className="text-xs text-slate-500 mb-4">
            このセルの実績の一覧です。合計 {yen(detailCell?.total ?? 0)}（
            {detailCell?.records.length ?? 0} 件）。明細の科目は履歴から変えられます。
          </p>

          {detailCell && detailCell.records.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-slate-500 border-b border-slate-200">
                    <th className="text-left py-2 pr-4 font-medium">登録日時</th>
                    <th className="text-left py-2 pr-4 font-medium">出どころ</th>
                    <th className="text-left py-2 pr-4 font-medium">内容</th>
                    <th className="text-right py-2 pr-2 font-medium">金額</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {detailCell.records.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50">
                      <td className="py-2 pr-4 text-xs font-mono text-slate-500 whitespace-nowrap">
                        {fmtDate(r.createdAt)}
                      </td>
                      <td className="py-2 pr-4 whitespace-nowrap">
                        <span
                          className={`text-[10px] px-1.5 py-0.5 rounded ${SOURCE_BADGE[r.source.kind]}`}
                        >
                          {SOURCE_LABEL[r.source.kind]}
                        </span>
                      </td>
                      <td className="py-2 pr-4 text-xs text-slate-600">
                        {r.source.description ? (
                          <>
                            {r.source.date &&
                              `${new Date(r.source.date).toLocaleDateString("ja-JP")} · `}
                            {r.source.description}
                            {r.source.accountName && (
                              <span className="text-slate-400">（{r.source.accountName}）</span>
                            )}
                          </>
                        ) : (
                          <span className="text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                        {yen(Number(r.amount))}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-400">このセルの実績はありません。</p>
          )}
        </Modal>
      )}
    </>
  );
}
