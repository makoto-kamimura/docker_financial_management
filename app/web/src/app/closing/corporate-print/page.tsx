"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

type AccountRow = {
  accountId: number;
  code: string;
  name: string;
  category: string;
  total: number;
};
type Ratios = {
  currentRatio: number | null;
  equityRatio: number | null;
  roa: number | null;
  roe: number | null;
  grossProfitRate: number | null;
  operatingMargin: number | null;
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
  ratios: Ratios | null;
};

type Tenant = {
  companyName: string;
  corporateNumber?: string | null;
  address?: string | null;
  representative?: string | null;
};

const yen = (v: number) => v.toLocaleString("ja-JP");

function CorporatePrint() {
  const searchParams = useSearchParams();
  const yearParam = searchParams.get("year");
  const [data, setData] = useState<Statements | null>(null);
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const year = yearParam ?? new Date().getFullYear().toString();
    Promise.all([
      fetch(`/api/closing/statements?year=${year}`).then((r) => r.json()),
      fetch("/api/tenants").then((r) => r.json()),
    ]).then(([d, t]) => {
      setData(d);
      setTenant((t.data ?? [])[0] ?? null);
      setLoading(false);
    });
  }, [yearParam]);

  if (loading) return <div className="p-8 text-center text-gray-500">読み込み中…</div>;
  if (!data) return <div className="p-8 text-center text-gray-500">データがありません</div>;

  const { fiscalYear, pnl, bs, ratios } = data;
  const today = new Date().toLocaleDateString("ja-JP");
  const retainedEarnings = pnl.netIncome; // 当期純利益 = 繰越利益剰余金変動額

  return (
    <>
      <style>{`
        @media print {
          body { margin: 0; font-size: 10pt; }
          .no-print { display: none !important; }
          .page-break { page-break-before: always; }
          table { border-collapse: collapse; }
          th, td { font-size: 9pt; }
        }
        body { font-family: 'Hiragino Kaku Gothic Pro', 'Meiryo', sans-serif; }
        table { width: 100%; border-collapse: collapse; }
        th, td { border: 1px solid #ccc; padding: 4px 8px; }
        th { background: #e8ecf0; font-weight: bold; text-align: center; }
        .amount { text-align: right; font-family: monospace; }
        .total-row { background: #e0e8f0; font-weight: bold; }
        .section-header { background: #c8d8e8; font-weight: bold; }
        .indent { padding-left: 24px; }
        .header-box { border: 2px solid #333; padding: 8px 16px; margin-bottom: 16px; }
      `}</style>

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
        {/* ─── 表紙 ─── */}
        <div className="mb-10 text-center">
          <h1 className="text-2xl font-bold mb-1">法人決算書類</h1>
          <p className="text-base text-gray-600">
            {fiscalYear}年1月1日 〜 {fiscalYear}年12月31日
          </p>
          {tenant && (
            <div className="mt-4 inline-block text-left border border-gray-300 rounded px-6 py-3">
              <table style={{ width: "auto", borderCollapse: "separate", border: "none" }}>
                <tbody>
                  <tr>
                    <td style={{ border: "none", padding: "2px 12px 2px 0", color: "#666" }}>
                      法人名
                    </td>
                    <td style={{ border: "none", fontWeight: "bold" }}>{tenant.companyName}</td>
                  </tr>
                  {tenant.corporateNumber && (
                    <tr>
                      <td style={{ border: "none", padding: "2px 12px 2px 0", color: "#666" }}>
                        法人番号
                      </td>
                      <td style={{ border: "none" }}>{tenant.corporateNumber}</td>
                    </tr>
                  )}
                  {tenant.representative && (
                    <tr>
                      <td style={{ border: "none", padding: "2px 12px 2px 0", color: "#666" }}>
                        代表者
                      </td>
                      <td style={{ border: "none" }}>{tenant.representative}</td>
                    </tr>
                  )}
                  {tenant.address && (
                    <tr>
                      <td style={{ border: "none", padding: "2px 12px 2px 0", color: "#666" }}>
                        所在地
                      </td>
                      <td style={{ border: "none" }}>{tenant.address}</td>
                    </tr>
                  )}
                  <tr>
                    <td style={{ border: "none", padding: "2px 12px 2px 0", color: "#666" }}>
                      作成日
                    </td>
                    <td style={{ border: "none" }}>{today}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* ─── 損益計算書 ─── */}
        <div className="page-break mb-8">
          <h2 className="text-xl font-bold mb-3 text-center border-b-2 border-gray-800 pb-2">
            損益計算書（P/L）
          </h2>
          <p className="text-center text-sm text-gray-600 mb-4">
            {fiscalYear}年1月1日 〜 {fiscalYear}年12月31日　（単位：円）
          </p>
          <table>
            <thead>
              <tr>
                <th className="text-left">科目</th>
                <th style={{ width: "140px" }}>金額</th>
              </tr>
            </thead>
            <tbody>
              <tr className="section-header">
                <td colSpan={2}>Ⅰ 売上高</td>
              </tr>
              {pnl.revenue.map((a) => (
                <tr key={a.accountId}>
                  <td className="indent">{a.name}</td>
                  <td className="amount">{yen(a.total)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>売上高合計</td>
                <td className="amount">{yen(pnl.revenueTotal)}</td>
              </tr>

              <tr className="section-header">
                <td colSpan={2}>Ⅱ 売上原価</td>
              </tr>
              {pnl.cogs.map((a) => (
                <tr key={a.accountId}>
                  <td className="indent">{a.name}</td>
                  <td className="amount">{yen(a.total)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>売上原価合計</td>
                <td className="amount">{yen(pnl.cogsTotal)}</td>
              </tr>
              <tr className="total-row">
                <td>売上総利益</td>
                <td className="amount">{yen(pnl.grossProfit)}</td>
              </tr>

              <tr className="section-header">
                <td colSpan={2}>Ⅲ 販売費及び一般管理費</td>
              </tr>
              {pnl.expenses.map((a) => (
                <tr key={a.accountId}>
                  <td className="indent">{a.name}</td>
                  <td className="amount">{yen(a.total)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td>販管費合計</td>
                <td className="amount">{yen(pnl.expenseTotal)}</td>
              </tr>

              <tr style={{ background: "#b8cce4", fontWeight: "bold" }}>
                <td>営業利益</td>
                <td className="amount">{yen(pnl.grossProfit - pnl.expenseTotal)}</td>
              </tr>
              <tr style={{ background: "#b8cce4", fontWeight: "bold" }}>
                <td>当期純利益</td>
                <td className="amount">{yen(pnl.netIncome)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ─── 貸借対照表 ─── */}
        <div className="page-break mb-8">
          <h2 className="text-xl font-bold mb-3 text-center border-b-2 border-gray-800 pb-2">
            貸借対照表（B/S）
          </h2>
          <p className="text-center text-sm text-gray-600 mb-4">
            {fiscalYear}年12月31日現在　（単位：円）
          </p>
          <table>
            <thead>
              <tr>
                <th className="text-left" style={{ width: "50%" }}>
                  資産の部
                </th>
                <th style={{ width: "120px" }}>金額</th>
                <th className="text-left" style={{ width: "50%" }}>
                  負債・純資産の部
                </th>
                <th style={{ width: "120px" }}>金額</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const assets = bs.assets;
                const liabs = bs.liabilities;
                const maxLen = Math.max(assets.length, liabs.length);
                const rows = [];
                for (let i = 0; i < maxLen; i++) {
                  const a = assets[i];
                  const l = liabs[i];
                  rows.push(
                    <tr key={i}>
                      <td className={a ? "indent" : ""}>{a?.name ?? ""}</td>
                      <td className="amount">{a ? yen(a.total) : ""}</td>
                      <td className={l ? "indent" : ""}>{l?.name ?? ""}</td>
                      <td className="amount">{l ? yen(l.total) : ""}</td>
                    </tr>,
                  );
                }
                return rows;
              })()}
              <tr className="total-row">
                <td>資産合計</td>
                <td className="amount">{yen(bs.assetTotal)}</td>
                <td>負債合計</td>
                <td className="amount">{yen(bs.liabilityTotal)}</td>
              </tr>
              <tr>
                <td></td>
                <td></td>
                <td>純資産（資本）</td>
                <td className="amount">{yen(bs.equity)}</td>
              </tr>
              <tr className="total-row">
                <td></td>
                <td></td>
                <td>負債・純資産合計</td>
                <td className="amount">{yen(bs.liabilityTotal + bs.equity)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ─── 株主資本等変動計算書 ─── */}
        <div className="page-break mb-8">
          <h2 className="text-xl font-bold mb-3 text-center border-b-2 border-gray-800 pb-2">
            株主資本等変動計算書（S/S）
          </h2>
          <p className="text-center text-sm text-gray-600 mb-4">
            {fiscalYear}年1月1日 〜 {fiscalYear}年12月31日　（単位：円）
          </p>
          <table>
            <thead>
              <tr>
                <th className="text-left">項目</th>
                <th>資本金</th>
                <th>利益剰余金</th>
                <th>純資産合計</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>当期首残高</td>
                <td className="amount">{yen(bs.equity - retainedEarnings)}</td>
                <td className="amount">—</td>
                <td className="amount">{yen(bs.equity - retainedEarnings)}</td>
              </tr>
              <tr>
                <td className="indent">当期純利益</td>
                <td className="amount">—</td>
                <td className="amount">{yen(retainedEarnings)}</td>
                <td className="amount">{yen(retainedEarnings)}</td>
              </tr>
              <tr className="total-row">
                <td>当期末残高</td>
                <td className="amount">{yen(bs.equity - retainedEarnings)}</td>
                <td className="amount">{yen(retainedEarnings)}</td>
                <td className="amount">{yen(bs.equity)}</td>
              </tr>
            </tbody>
          </table>
        </div>

        {/* ─── 財務指標メモ ─── */}
        {ratios && (
          <div className="page-break mb-8">
            <h2 className="text-xl font-bold mb-3 text-center border-b-2 border-gray-800 pb-2">
              財務指標（注記）
            </h2>
            <table>
              <thead>
                <tr>
                  <th className="text-left">指標名</th>
                  <th style={{ width: "160px" }}>数値</th>
                </tr>
              </thead>
              <tbody>
                {[
                  ["流動比率", ratios.currentRatio != null ? `${ratios.currentRatio}倍` : "—"],
                  ["自己資本比率", ratios.equityRatio != null ? `${ratios.equityRatio}%` : "—"],
                  ["ROA", ratios.roa != null ? `${ratios.roa}%` : "—"],
                  ["ROE", ratios.roe != null ? `${ratios.roe}%` : "—"],
                  [
                    "売上総利益率",
                    ratios.grossProfitRate != null ? `${ratios.grossProfitRate}%` : "—",
                  ],
                  [
                    "営業利益率",
                    ratios.operatingMargin != null ? `${ratios.operatingMargin}%` : "—",
                  ],
                ].map(([label, val]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="amount">{val}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* ─── 法人税概算 ─── */}
        <div className="page-break mb-8">
          <h2 className="text-xl font-bold mb-3 text-center border-b-2 border-gray-800 pb-2">
            法人税・地方税 概算申告資料
          </h2>
          <p className="text-center text-sm text-gray-500 mb-4">
            ※ 正式申告には税務専門家への確認が必要です
          </p>
          <table>
            <thead>
              <tr>
                <th className="text-left">項目</th>
                <th style={{ width: "200px" }}>金額（概算）</th>
              </tr>
            </thead>
            <tbody>
              {(() => {
                const taxableIncome = Math.max(0, pnl.netIncome);
                const corpTaxRate = taxableIncome <= 8_000_000 ? 0.15 : 0.234;
                const corpTax = Math.floor(taxableIncome * corpTaxRate);
                const localRate = 0.034;
                const localTax = Math.floor(taxableIncome * localRate);
                const totalTax = corpTax + localTax;
                return [
                  ["課税所得（概算）", taxableIncome],
                  ["法人税（概算）", corpTax],
                  ["地方法人税・住民税（概算）", localTax],
                  ["法人税等合計（概算）", totalTax],
                  ["税引後利益（概算）", pnl.netIncome - totalTax],
                ].map(([label, val]) => (
                  <tr key={label}>
                    <td>{label}</td>
                    <td className="amount">¥{yen(val as number)}</td>
                  </tr>
                ));
              })()}
            </tbody>
          </table>
          <p className="text-xs text-gray-400 mt-4">
            ※ 法人税率: 中小法人（所得800万円以下）15%、超過分23.4%。地方法人税率: 3.4%（概算）
          </p>
        </div>

        {/* フッター */}
        <div className="text-center text-sm text-gray-400 mt-12 border-t pt-4">
          <p>作成日: {today} | 決算管理システム</p>
        </div>
      </div>
    </>
  );
}

export default function CorporatePrintPage() {
  return (
    <Suspense fallback={<div className="p-8 text-center text-gray-500">読み込み中…</div>}>
      <CorporatePrint />
    </Suspense>
  );
}
