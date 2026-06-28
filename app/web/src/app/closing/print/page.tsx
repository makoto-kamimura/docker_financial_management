"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

// ── 型定義 ──────────────────────────────────────────────────────────────
type AccountRow = {
  accountId: number;
  code: string;
  name: string;
  category: string;
  total: number;
  businessRate?: number;
  deductible?: number;
};
type Statements = {
  fiscalYear: number;
  pnl: {
    revenue: AccountRow[];
    revenueTotal: number;
    cogs: AccountRow[];
    cogsTotal: number;
    grossProfit: number;
    expenses: AccountRow[];
    expenseTotal: number;
    expenseDeductible: number;
    netIncome: number;
  };
  bs: {
    assets: AccountRow[];
    assetTotal: number;
    liabilities: AccountRow[];
    liabilityTotal: number;
    equity: number;
  };
  monthly: Record<string, { revenue: number; cogs: number; expense: number }>;
  businessProfile: {
    tradeName: string | null;
    ownerName: string;
    blueReturn: boolean;
    taxationType: string;
    invoiceNumber: string | null;
    openedOn: string | null;
  } | null;
  closeStatus: { status: string; closedAt: string | null } | null;
};

const yen = (v: number) => Math.abs(v).toLocaleString("ja-JP");

function PrintPage() {
  const searchParams = useSearchParams();
  const yearParam = searchParams.get("year");
  const [data, setData] = useState<Statements | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const year = yearParam ?? new Date().getFullYear().toString();
    fetch(`/api/closing/statements?year=${year}`)
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setLoading(false);
      });
  }, [yearParam]);

  if (loading) return <div className="p-8 text-center text-gray-500">読み込み中…</div>;
  if (!data) return <div className="p-8 text-center text-gray-500">データがありません</div>;

  const { fiscalYear, pnl, bs, monthly, businessProfile, closeStatus } = data;
  const isBlue = businessProfile?.blueReturn ?? false;
  const ownerName = businessProfile?.ownerName ?? "";
  const tradeName = businessProfile?.tradeName ?? "";
  const invoiceNo = businessProfile?.invoiceNumber ?? "";
  const today = new Date().toLocaleDateString("ja-JP");

  const months = Array.from({ length: 12 }, (_, i) => i + 1);

  return (
    <>
      {/* 印刷専用スタイル */}
      <style>{`
        @media print {
          body { margin: 0; font-size: 10pt; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
          table { border-collapse: collapse; }
          th, td { font-size: 9pt; }
        }
        body { font-family: 'Hiragino Kaku Gothic Pro', 'Meiryo', sans-serif; }
        .doc-section { margin-bottom: 2rem; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ccc; padding: 3px 6px; font-size: 10pt; }
        th { background: #f0f0f0; font-weight: bold; text-align: center; }
        .amount { text-align: right; font-family: monospace; }
        .label { font-weight: bold; }
        .total-row { background: #e8e8e8; font-weight: bold; }
        .header-box { border: 2px solid #333; padding: 8px 16px; margin-bottom: 16px; }
      `}</style>

      {/* 印刷ボタン */}
      <div className="no-print fixed top-4 right-4 flex gap-2 z-50">
        <button
          onClick={() => window.print()}
          className="px-4 py-2 bg-indigo-600 text-white text-sm rounded-lg shadow hover:bg-indigo-700"
        >
          🖨 印刷 / PDF保存
        </button>
        <button
          onClick={() => window.close()}
          className="px-4 py-2 border border-gray-300 text-sm rounded-lg shadow hover:bg-gray-50"
        >
          閉じる
        </button>
      </div>

      <div className="max-w-4xl mx-auto p-8">
        {/* ─────────────────────────── 表紙 ─────────────────────────── */}
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-bold mb-2">{isBlue ? "青色申告決算書" : "収支内訳書"}</h1>
          <p className="text-base text-gray-600">
            {fiscalYear}年1月1日 〜 {fiscalYear}年12月31日
          </p>
          <div className="mt-4 inline-block text-left border border-gray-300 rounded px-6 py-3">
            <table style={{ width: "auto", borderCollapse: "separate", border: "none" }}>
              <tbody>
                <tr>
                  <td
                    style={{
                      border: "none",
                      padding: "2px 12px 2px 0",
                      color: "#666",
                      fontSize: "10pt",
                    }}
                  >
                    氏名
                  </td>
                  <td
                    style={{
                      border: "none",
                      padding: "2px 0",
                      fontWeight: "bold",
                      fontSize: "11pt",
                    }}
                  >
                    {ownerName}
                  </td>
                </tr>
                {tradeName && (
                  <tr>
                    <td
                      style={{
                        border: "none",
                        padding: "2px 12px 2px 0",
                        color: "#666",
                        fontSize: "10pt",
                      }}
                    >
                      屋号
                    </td>
                    <td
                      style={{
                        border: "none",
                        padding: "2px 0",
                        fontWeight: "bold",
                        fontSize: "11pt",
                      }}
                    >
                      {tradeName}
                    </td>
                  </tr>
                )}
                {invoiceNo && (
                  <tr>
                    <td
                      style={{
                        border: "none",
                        padding: "2px 12px 2px 0",
                        color: "#666",
                        fontSize: "10pt",
                      }}
                    >
                      登録番号
                    </td>
                    <td style={{ border: "none", padding: "2px 0", fontSize: "10pt" }}>
                      {invoiceNo}
                    </td>
                  </tr>
                )}
                <tr>
                  <td
                    style={{
                      border: "none",
                      padding: "2px 12px 2px 0",
                      color: "#666",
                      fontSize: "10pt",
                    }}
                  >
                    作成日
                  </td>
                  <td style={{ border: "none", padding: "2px 0", fontSize: "10pt" }}>{today}</td>
                </tr>
                {closeStatus?.closedAt && (
                  <tr>
                    <td
                      style={{
                        border: "none",
                        padding: "2px 12px 2px 0",
                        color: "#666",
                        fontSize: "10pt",
                      }}
                    >
                      決算確定日
                    </td>
                    <td
                      style={{
                        border: "none",
                        padding: "2px 0",
                        fontSize: "10pt",
                        color: "#059669",
                      }}
                    >
                      {new Date(closeStatus.closedAt).toLocaleDateString("ja-JP")}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* ─────────────────── 損益計算書 ─────────────────── */}
        <div className="doc-section">
          <h2 className="text-lg font-bold border-b-2 border-gray-800 mb-3 pb-1">
            損益計算書（{fiscalYear}年1月〜12月）
          </h2>

          <table>
            <thead>
              <tr>
                <th style={{ width: "80px" }}>科目コード</th>
                <th>科目名</th>
                <th style={{ width: "130px" }}>金額（円）</th>
              </tr>
            </thead>
            <tbody>
              {/* 収入 */}
              <tr>
                <td
                  colSpan={3}
                  style={{ background: "#dbe4ff", fontWeight: "bold", padding: "4px 6px" }}
                >
                  【収入金額】
                </td>
              </tr>
              {pnl.revenue.map((a) => (
                <tr key={a.accountId}>
                  <td style={{ textAlign: "center", fontSize: "9pt" }}>{a.code}</td>
                  <td>{a.name}</td>
                  <td className="amount">{yen(a.total)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={2} style={{ textAlign: "right" }}>
                  収入合計
                </td>
                <td className="amount">{yen(pnl.revenueTotal)}</td>
              </tr>

              {/* 売上原価 */}
              {pnl.cogs.length > 0 && (
                <>
                  <tr>
                    <td
                      colSpan={3}
                      style={{ background: "#dbe4ff", fontWeight: "bold", padding: "4px 6px" }}
                    >
                      【売上原価】
                    </td>
                  </tr>
                  {pnl.cogs.map((a) => (
                    <tr key={a.accountId}>
                      <td style={{ textAlign: "center", fontSize: "9pt" }}>{a.code}</td>
                      <td>{a.name}</td>
                      <td className="amount">{yen(a.total)}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td colSpan={2} style={{ textAlign: "right" }}>
                      原価合計
                    </td>
                    <td className="amount">{yen(pnl.cogsTotal)}</td>
                  </tr>
                </>
              )}

              {/* 売上総利益 */}
              <tr style={{ background: "#e0f2fe", fontWeight: "bold" }}>
                <td colSpan={2} style={{ textAlign: "right" }}>
                  売上総利益
                </td>
                <td className="amount">{yen(pnl.grossProfit)}</td>
              </tr>

              {/* 経費 */}
              <tr>
                <td
                  colSpan={3}
                  style={{ background: "#dbe4ff", fontWeight: "bold", padding: "4px 6px" }}
                >
                  【経費（必要経費）】
                </td>
              </tr>
              {pnl.expenses.map((a) => (
                <tr key={a.accountId}>
                  <td style={{ textAlign: "center", fontSize: "9pt" }}>{a.code}</td>
                  <td>
                    {a.name}
                    {(a.businessRate ?? 100) < 100 && (
                      <span style={{ fontSize: "8pt", color: "#666", marginLeft: "6px" }}>
                        （按分{a.businessRate}%）
                      </span>
                    )}
                  </td>
                  <td className="amount">{yen(a.deductible ?? a.total)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={2} style={{ textAlign: "right" }}>
                  経費合計（必要経費）
                </td>
                <td className="amount">{yen(pnl.expenseDeductible)}</td>
              </tr>

              {/* 事業所得 */}
              <tr style={{ background: "#dcfce7", fontWeight: "bold", fontSize: "11pt" }}>
                <td colSpan={2} style={{ textAlign: "right" }}>
                  事業所得（課税所得）
                </td>
                <td className="amount">{yen(pnl.netIncome)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ─────────────────── 月別収支表 ─────────────────── */}
        <div className="doc-section page-break">
          <h2 className="text-lg font-bold border-b-2 border-gray-800 mb-3 pb-1">
            月別収支表（{fiscalYear}年）
          </h2>
          <table>
            <thead>
              <tr>
                <th>月</th>
                <th>収入（円）</th>
                <th>売上原価（円）</th>
                <th>経費（円）</th>
                <th>差引利益（円）</th>
              </tr>
            </thead>
            <tbody>
              {months.map((m) => {
                const d = monthly[m] ?? { revenue: 0, cogs: 0, expense: 0 };
                const profit = d.revenue - d.cogs - d.expense;
                return (
                  <tr key={m}>
                    <td style={{ textAlign: "center" }}>{m}月</td>
                    <td className="amount">{d.revenue > 0 ? yen(d.revenue) : ""}</td>
                    <td className="amount">{d.cogs > 0 ? yen(d.cogs) : ""}</td>
                    <td className="amount">{d.expense > 0 ? yen(d.expense) : ""}</td>
                    <td className="amount" style={{ fontWeight: profit !== 0 ? "bold" : "normal" }}>
                      {profit !== 0 ? (profit < 0 ? "△" : "") + yen(profit) : ""}
                    </td>
                  </tr>
                );
              })}
              <tr className="total-row">
                <td style={{ textAlign: "center" }}>合計</td>
                <td className="amount">{yen(pnl.revenueTotal)}</td>
                <td className="amount">{yen(pnl.cogsTotal)}</td>
                <td className="amount">{yen(pnl.expenseTotal)}</td>
                <td className="amount">
                  {yen(pnl.revenueTotal - pnl.cogsTotal - pnl.expenseDeductible)}
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ─────────────────── 貸借対照表（青色申告のみ） ─────────────────── */}
        {isBlue && (
          <div className="doc-section page-break">
            <h2 className="text-lg font-bold border-b-2 border-gray-800 mb-3 pb-1">
              貸借対照表（{fiscalYear}年12月31日現在）
            </h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
              <div>
                <table>
                  <thead>
                    <tr>
                      <th colSpan={2}>資産の部</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bs.assets.map((a) => (
                      <tr key={a.accountId}>
                        <td>
                          {a.name}
                          <span style={{ fontSize: "8pt", color: "#666", marginLeft: "4px" }}>
                            {a.code}
                          </span>
                        </td>
                        <td className="amount">{yen(a.total)}</td>
                      </tr>
                    ))}
                    <tr className="total-row">
                      <td>資産合計</td>
                      <td className="amount">{yen(bs.assetTotal)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div>
                <table>
                  <thead>
                    <tr>
                      <th colSpan={2}>負債・資本の部</th>
                    </tr>
                  </thead>
                  <tbody>
                    {bs.liabilities.map((a) => (
                      <tr key={a.accountId}>
                        <td>
                          {a.name}
                          <span style={{ fontSize: "8pt", color: "#666", marginLeft: "4px" }}>
                            {a.code}
                          </span>
                        </td>
                        <td className="amount">{yen(a.total)}</td>
                      </tr>
                    ))}
                    <tr className="total-row">
                      <td>負債合計</td>
                      <td className="amount">{yen(bs.liabilityTotal)}</td>
                    </tr>
                    <tr style={{ background: "#e0f2fe", fontWeight: "bold" }}>
                      <td>純資産（資産−負債）</td>
                      <td className="amount">{yen(bs.equity)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* ─────────────────── 家事按分計算書 ─────────────────── */}
        {pnl.expenses.some((e) => (e.businessRate ?? 100) < 100) && (
          <div className="doc-section">
            <h2 className="text-lg font-bold border-b-2 border-gray-800 mb-3 pb-1">
              家事按分計算書
            </h2>
            <table>
              <thead>
                <tr>
                  <th>科目名</th>
                  <th>支出額（円）</th>
                  <th>事業利用率</th>
                  <th>必要経費（円）</th>
                  <th>家事分（円）</th>
                </tr>
              </thead>
              <tbody>
                {pnl.expenses
                  .filter((e) => (e.businessRate ?? 100) < 100)
                  .map((e) => (
                    <tr key={e.accountId}>
                      <td>{e.name}</td>
                      <td className="amount">{yen(e.total)}</td>
                      <td style={{ textAlign: "center" }}>{e.businessRate}%</td>
                      <td className="amount">{yen(e.deductible ?? 0)}</td>
                      <td className="amount">{yen(e.total - (e.deductible ?? 0))}</td>
                    </tr>
                  ))}
                <tr className="total-row">
                  <td colSpan={3} style={{ textAlign: "right" }}>
                    按分後経費合計
                  </td>
                  <td className="amount">{yen(pnl.expenseDeductible)}</td>
                  <td className="amount">{yen(pnl.expenseTotal - pnl.expenseDeductible)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        <p style={{ marginTop: "2rem", fontSize: "8pt", color: "#999", textAlign: "right" }}>
          出力日時: {new Date().toLocaleString("ja-JP")} ／{" "}
          {isBlue ? "青色申告" : "白色申告（収支内訳書）"}
        </p>
      </div>
    </>
  );
}

export default function PrintPageWrapper() {
  return (
    <Suspense fallback={<div className="p-8">読み込み中…</div>}>
      <PrintPage />
    </Suspense>
  );
}
