"use client";

import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/AppShell";

// ── 型定義 ──────────────────────────────────────────────────────────────
type AccountRow = {
  accountId: number; code: string; name: string; category: string;
  total: number; businessRate?: number; deductible?: number;
};

type Ratios = {
  currentRatio: number | null; equityRatio: number | null;
  roa: number | null; roe: number | null;
  grossProfitRate: number | null; operatingMargin: number | null;
};

type Statements = {
  fiscalYear: number;
  pnl: {
    revenue: AccountRow[]; revenueTotal: number;
    cogs: AccountRow[]; cogsTotal: number; grossProfit: number;
    expenses: AccountRow[]; expenseTotal: number; expenseDeductible: number;
    netIncome: number;
  };
  bs: {
    assets: AccountRow[]; assetTotal: number;
    liabilities: AccountRow[]; liabilityTotal: number;
    equity: number;
  };
  ratios: Ratios;
  trialBalance: AccountRow[];
  monthly: Record<string, { revenue: number; cogs: number; expense: number }>;
  businessProfile: { tradeName: string | null; ownerName: string; blueReturn: boolean } | null;
  closeStatus: { status: string; closedAt: string | null } | null;
};

const yen = (v: number) =>
  v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

const CATEGORY_LABELS: Record<string, string> = {
  REVENUE: "収入",
  COGS: "売上原価",
  EXPENSE: "経費",
  ASSET: "資産",
  LIABILITY: "負債",
  PROFIT: "損益",
  OTHER: "その他",
};

// ── 損益計算書タブ ───────────────────────────────────────────────────────
function PnlTab({ pnl }: { pnl: Statements["pnl"] }) {
  return (
    <div className="space-y-4">
      {/* 収入 */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2 border-b border-slate-200 pb-1">収入金額</h3>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-50">
            {pnl.revenue.map(a => (
              <tr key={a.accountId} className="hover:bg-slate-50/60">
                <td className="py-1.5 text-slate-500 text-xs w-20">{a.code}</td>
                <td className="py-1.5 text-slate-700">{a.name}</td>
                <td className="py-1.5 text-right font-medium text-emerald-700">{yen(a.total)}</td>
              </tr>
            ))}
            <tr className="font-semibold border-t border-slate-200">
              <td colSpan={2} className="py-2 text-slate-800">収入合計</td>
              <td className="py-2 text-right text-emerald-700 text-base">{yen(pnl.revenueTotal)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 売上原価 */}
      {pnl.cogs.length > 0 && (
        <section>
          <h3 className="text-sm font-semibold text-slate-700 mb-2 border-b border-slate-200 pb-1">売上原価</h3>
          <table className="w-full text-sm">
            <tbody className="divide-y divide-slate-50">
              {pnl.cogs.map(a => (
                <tr key={a.accountId} className="hover:bg-slate-50/60">
                  <td className="py-1.5 text-slate-500 text-xs w-20">{a.code}</td>
                  <td className="py-1.5 text-slate-700">{a.name}</td>
                  <td className="py-1.5 text-right font-medium text-red-600">{yen(a.total)}</td>
                </tr>
              ))}
              <tr className="font-semibold border-t border-slate-200">
                <td colSpan={2} className="py-2 text-slate-800">原価合計</td>
                <td className="py-2 text-right text-red-600">{yen(pnl.cogsTotal)}</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {/* 売上総利益 */}
      <div className="bg-indigo-50 border border-indigo-100 rounded-lg px-4 py-3 flex justify-between items-center">
        <span className="font-semibold text-indigo-800">売上総利益</span>
        <span className="text-lg font-bold text-indigo-700">{yen(pnl.grossProfit)}</span>
      </div>

      {/* 経費 */}
      <section>
        <h3 className="text-sm font-semibold text-slate-700 mb-2 border-b border-slate-200 pb-1">
          経費
          {pnl.expenseTotal !== pnl.expenseDeductible && (
            <span className="ml-2 text-xs font-normal text-slate-400">（家事按分後）</span>
          )}
        </h3>
        <table className="w-full text-sm">
          <thead className="text-xs text-slate-400">
            <tr>
              <th className="text-left pb-1 font-medium w-20">コード</th>
              <th className="text-left pb-1 font-medium">科目名</th>
              <th className="text-right pb-1 font-medium">支出額</th>
              {pnl.expenses.some(e => (e.businessRate ?? 100) < 100) && (
                <>
                  <th className="text-right pb-1 font-medium w-16">按分率</th>
                  <th className="text-right pb-1 font-medium">必要経費</th>
                </>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-50">
            {pnl.expenses.map(a => (
              <tr key={a.accountId} className="hover:bg-slate-50/60">
                <td className="py-1.5 text-slate-500 text-xs">{a.code}</td>
                <td className="py-1.5 text-slate-700">{a.name}</td>
                <td className="py-1.5 text-right text-slate-700">{yen(a.total)}</td>
                {pnl.expenses.some(e => (e.businessRate ?? 100) < 100) && (
                  <>
                    <td className="py-1.5 text-right text-xs text-slate-400">
                      {a.businessRate === 100 || a.businessRate === undefined ? "—" : `${a.businessRate}%`}
                    </td>
                    <td className="py-1.5 text-right font-medium text-red-600">{yen(a.deductible ?? a.total)}</td>
                  </>
                )}
              </tr>
            ))}
            <tr className="font-semibold border-t border-slate-200">
              <td colSpan={pnl.expenses.some(e => (e.businessRate ?? 100) < 100) ? 4 : 2}
                className="py-2 text-slate-800">経費合計（必要経費）</td>
              <td className="py-2 text-right text-red-600">{yen(pnl.expenseDeductible)}</td>
            </tr>
          </tbody>
        </table>
      </section>

      {/* 事業所得 */}
      <div className={`border rounded-lg px-4 py-4 flex justify-between items-center ${
        pnl.netIncome >= 0 ? "bg-emerald-50 border-emerald-200" : "bg-red-50 border-red-200"
      }`}>
        <div>
          <p className={`font-bold text-lg ${pnl.netIncome >= 0 ? "text-emerald-800" : "text-red-700"}`}>
            事業所得（課税所得）
          </p>
          <p className="text-xs text-slate-500 mt-0.5">収入 − 原価 − 必要経費（家事按分後）</p>
        </div>
        <span className={`text-2xl font-bold ${pnl.netIncome >= 0 ? "text-emerald-700" : "text-red-600"}`}>
          {yen(pnl.netIncome)}
        </span>
      </div>
    </div>
  );
}

// ── 貸借対照表タブ ───────────────────────────────────────────────────────
function BsTab({ bs }: { bs: Statements["bs"] }) {
  return (
    <div className="grid grid-cols-2 gap-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2 border-b border-slate-200 pb-1">資産の部</h3>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-50">
            {bs.assets.map(a => (
              <tr key={a.accountId} className="hover:bg-slate-50/60">
                <td className="py-1.5 text-slate-500 text-xs w-16">{a.code}</td>
                <td className="py-1.5 text-slate-700 text-xs">{a.name}</td>
                <td className="py-1.5 text-right font-medium text-emerald-700">{yen(a.total)}</td>
              </tr>
            ))}
            <tr className="font-semibold border-t-2 border-slate-300">
              <td colSpan={2} className="py-2 text-slate-800">資産合計</td>
              <td className="py-2 text-right text-emerald-700 text-base">{yen(bs.assetTotal)}</td>
            </tr>
          </tbody>
        </table>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-2 border-b border-slate-200 pb-1">負債の部</h3>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-slate-50">
            {bs.liabilities.map(a => (
              <tr key={a.accountId} className="hover:bg-slate-50/60">
                <td className="py-1.5 text-slate-500 text-xs w-16">{a.code}</td>
                <td className="py-1.5 text-slate-700 text-xs">{a.name}</td>
                <td className="py-1.5 text-right font-medium text-red-600">{yen(a.total)}</td>
              </tr>
            ))}
            <tr className="font-semibold border-t border-slate-200">
              <td colSpan={2} className="py-2 text-slate-800">負債合計</td>
              <td className="py-2 text-right text-red-600">{yen(bs.liabilityTotal)}</td>
            </tr>
            <tr className="font-semibold">
              <td colSpan={2} className="py-2 text-slate-800">純資産（資産−負債）</td>
              <td className={`py-2 text-right font-bold ${bs.equity >= 0 ? "text-indigo-700" : "text-red-600"}`}>
                {yen(bs.equity)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── 試算表タブ ───────────────────────────────────────────────────────────
function TrialBalanceTab({ rows }: { rows: AccountRow[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-slate-500 border-b border-slate-200">
            <th className="text-left py-2 font-medium w-20">コード</th>
            <th className="text-left py-2 font-medium">科目名</th>
            <th className="text-left py-2 font-medium w-24">種別</th>
            <th className="text-right py-2 font-medium">残高</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {rows.map(a => (
            <tr key={a.accountId} className="hover:bg-slate-50/60">
              <td className="py-1.5 font-mono text-xs text-slate-500">{a.code}</td>
              <td className="py-1.5 text-slate-700">{a.name}</td>
              <td className="py-1.5 text-xs text-slate-400">{CATEGORY_LABELS[a.category] ?? a.category}</td>
              <td className={`py-1.5 text-right font-medium ${
                ["ASSET", "EXPENSE", "COGS"].includes(a.category) ? "text-slate-800" : "text-emerald-700"
              }`}>
                {yen(a.total)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── 財務分析タブ（法人向け指標）────────────────────────────────────────────
function RatiosTab({ ratios, bs, pnl }: { ratios: Ratios; bs: Statements["bs"]; pnl: Statements["pnl"] }) {
  const metric = (
    label: string, value: number | null, unit: string, description: string,
    good: (v: number) => boolean
  ) => (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <div className="flex items-baseline gap-1.5">
        {value === null ? (
          <span className="text-slate-400 text-sm">計算不可</span>
        ) : (
          <>
            <span className={`text-2xl font-bold ${good(value) ? "text-indigo-700" : "text-red-600"}`}>
              {value.toLocaleString()}
            </span>
            <span className="text-sm text-slate-500">{unit}</span>
          </>
        )}
      </div>
      <p className="text-xs text-slate-400 mt-1.5">{description}</p>
    </div>
  );

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">安全性指標</h3>
        <div className="grid grid-cols-2 gap-4">
          {metric("流動比率", ratios.currentRatio, "倍", "流動資産 ÷ 流動負債。200%（2倍）以上が理想。", v => v >= 2)}
          {metric("自己資本比率", ratios.equityRatio, "%", "純資産 ÷ 総資産。40%以上が優良。", v => v >= 40)}
        </div>
      </div>
      <div>
        <h3 className="text-sm font-semibold text-slate-700 mb-3">収益性指標</h3>
        <div className="grid grid-cols-2 gap-4">
          {metric("ROA（総資産利益率）", ratios.roa, "%", "当期純利益 ÷ 総資産。5%以上が目安。", v => v >= 5)}
          {metric("ROE（自己資本利益率）", ratios.roe, "%", "当期純利益 ÷ 純資産。10%以上が目安。", v => v >= 10)}
          {metric("売上総利益率", ratios.grossProfitRate, "%", "売上総利益 ÷ 売上高。業種により異なる。", v => v >= 20)}
          {metric("営業利益率（純利益率）", ratios.operatingMargin, "%", "当期純利益 ÷ 売上高。5%以上が目安。", v => v >= 5)}
        </div>
      </div>
      <div className="bg-slate-50 rounded-xl p-5">
        <h3 className="text-sm font-semibold text-slate-700 mb-3">計算の元データ</h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div><p className="text-slate-500 text-xs mb-0.5">総資産</p><p className="font-semibold">{yen(bs.assetTotal)}</p></div>
          <div><p className="text-slate-500 text-xs mb-0.5">総負債</p><p className="font-semibold">{yen(bs.liabilityTotal)}</p></div>
          <div><p className="text-slate-500 text-xs mb-0.5">純資産</p><p className="font-semibold">{yen(bs.equity)}</p></div>
          <div><p className="text-slate-500 text-xs mb-0.5">売上高</p><p className="font-semibold">{yen(pnl.revenueTotal)}</p></div>
          <div><p className="text-slate-500 text-xs mb-0.5">売上総利益</p><p className="font-semibold">{yen(pnl.grossProfit)}</p></div>
          <div><p className="text-slate-500 text-xs mb-0.5">当期純利益</p><p className="font-semibold">{yen(pnl.netIncome)}</p></div>
        </div>
      </div>
    </div>
  );
}

// ── 月別収支タブ ─────────────────────────────────────────────────────────
function MonthlyTab({ monthly, fiscalYear }: { monthly: Statements["monthly"]; fiscalYear: number }) {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const totals = months.reduce(
    (acc, m) => ({
      revenue: acc.revenue + (monthly[m]?.revenue ?? 0),
      cogs:    acc.cogs    + (monthly[m]?.cogs    ?? 0),
      expense: acc.expense + (monthly[m]?.expense ?? 0),
    }),
    { revenue: 0, cogs: 0, expense: 0 }
  );

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-slate-500 border-b border-slate-200">
            <th className="text-left py-2 font-medium w-16">月</th>
            <th className="text-right py-2 font-medium">収入</th>
            <th className="text-right py-2 font-medium">原価</th>
            <th className="text-right py-2 font-medium">経費</th>
            <th className="text-right py-2 font-medium">差引利益</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {months.map(m => {
            const d = monthly[m] ?? { revenue: 0, cogs: 0, expense: 0 };
            const profit = d.revenue - d.cogs - d.expense;
            return (
              <tr key={m} className="hover:bg-slate-50/60">
                <td className="py-1.5 font-medium text-slate-700">{fiscalYear}年{m}月</td>
                <td className="py-1.5 text-right text-emerald-700">{d.revenue > 0 ? yen(d.revenue) : "—"}</td>
                <td className="py-1.5 text-right text-red-600">{d.cogs > 0 ? yen(d.cogs) : "—"}</td>
                <td className="py-1.5 text-right text-red-600">{d.expense > 0 ? yen(d.expense) : "—"}</td>
                <td className={`py-1.5 text-right font-medium ${profit >= 0 ? "text-slate-800" : "text-red-600"}`}>
                  {yen(profit)}
                </td>
              </tr>
            );
          })}
          <tr className="font-semibold border-t-2 border-slate-300">
            <td className="py-2 text-slate-800">年間合計</td>
            <td className="py-2 text-right text-emerald-700">{yen(totals.revenue)}</td>
            <td className="py-2 text-right text-red-600">{yen(totals.cogs)}</td>
            <td className="py-2 text-right text-red-600">{yen(totals.expense)}</td>
            <td className={`py-2 text-right ${
              totals.revenue - totals.cogs - totals.expense >= 0 ? "text-indigo-700" : "text-red-600"
            }`}>
              {yen(totals.revenue - totals.cogs - totals.expense)}
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

// ── メインページ ──────────────────────────────────────────────────────────
export default function ClosingPage() {
  const currentYear = new Date().getFullYear();
  const [year, setYear]     = useState(currentYear);
  const [tab, setTab]       = useState<"pnl" | "bs" | "trial" | "monthly" | "ratios">("pnl");
  const [etaxOpen, setEtaxOpen] = useState(false);
  const etaxRef = useRef<HTMLDivElement>(null);
  const qc = useQueryClient();

  useEffect(() => {
    if (!etaxOpen) return;
    function close(e: MouseEvent) {
      if (etaxRef.current && !etaxRef.current.contains(e.target as Node)) {
        setEtaxOpen(false);
      }
    }
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [etaxOpen]);

  const { data, isLoading } = useQuery<Statements>({
    queryKey: ["closing-statements", year],
    queryFn: () =>
      fetch(`/api/closing/statements?year=${year}`).then(r => r.json()),
  });

  const finalizeMut = useMutation({
    mutationFn: (payload: { fiscalYear: number; netIncome: number }) =>
      fetch("/api/closing/finalize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["closing-statements"] }),
  });

  const reopenMut = useMutation({
    mutationFn: (year: number) =>
      fetch(`/api/closing/finalize?year=${year}`, { method: "DELETE" }).then(r => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["closing-statements"] }),
  });

  const isClosed = data?.closeStatus?.status === "closed";

  const TABS = [
    { key: "pnl",     label: "損益計算書" },
    { key: "bs",      label: "貸借対照表" },
    { key: "monthly", label: "月別収支" },
    { key: "trial",   label: "試算表" },
    { key: "ratios",  label: "財務分析" },
  ] as const;

  return (
    <AppShell>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="page-title">決算処理</h1>
          <p className="text-sm text-slate-500 mt-0.5">損益計算書・貸借対照表・申告書類の生成（F013〜F015）</p>
        </div>
        <div className="flex items-center gap-2">
          <select className="input-field w-28 py-1.5 text-sm" value={year}
            onChange={e => setYear(Number(e.target.value))}>
            {[currentYear + 1, currentYear, currentYear - 1, currentYear - 2, currentYear - 3].map(y => (
              <option key={y} value={y}>{y}年</option>
            ))}
          </select>
          <button type="button"
            onClick={() => window.open(`/closing/print?year=${year}`, "_blank")}
            className="text-sm px-4 py-1.5 border border-slate-300 rounded-lg hover:bg-slate-50 text-slate-700">
            🖨 個人申告書類
          </button>
          <button type="button"
            onClick={() => window.open(`/closing/corporate-print?year=${year}`, "_blank")}
            className="text-sm px-4 py-1.5 border border-indigo-300 rounded-lg hover:bg-indigo-50 text-indigo-700">
            🏢 法人決算書類
          </button>
          {/* e-Tax XML ダウンロード */}
          <div className="relative" ref={etaxRef}>
            <button type="button"
              onClick={() => setEtaxOpen(o => !o)}
              className="text-sm px-4 py-1.5 border border-emerald-300 rounded-lg hover:bg-emerald-50 text-emerald-700">
              📤 e-Tax XML ▾
            </button>
            {etaxOpen && (
              <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-lg shadow-lg z-20 min-w-max">
                {([
                  { type: "blue_return",     label: "青色申告決算書" },
                  { type: "corporate",       label: "法人税申告書" },
                  { type: "consumption_tax", label: "消費税申告書" },
                ] as const).map(({ type, label }) => (
                  <a key={type}
                    href={`/api/closing/etax?fiscalYear=${year}&type=${type}`}
                    download={`etax_${type}_${year}.xml`}
                    onClick={() => setEtaxOpen(false)}
                    className="block px-4 py-2 text-sm text-slate-700 hover:bg-slate-50 first:rounded-t-lg last:rounded-b-lg">
                    {label}
                  </a>
                ))}
              </div>
            )}
          </div>
          {!isClosed ? (
            <button type="button"
              onClick={() => {
                if (!data) return;
                if (!confirm(`${year}年度の決算を確定しますか？\n事業所得: ${yen(data.pnl.netIncome)}`)) return;
                finalizeMut.mutate({ fiscalYear: year, netIncome: data.pnl.netIncome });
              }}
              disabled={finalizeMut.isPending || isLoading}
              className="btn-primary text-sm px-4 py-1.5">
              決算確定
            </button>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs bg-emerald-100 text-emerald-700 px-3 py-1.5 rounded-lg font-medium">
                ✓ 決算確定済
              </span>
              <button type="button"
                onClick={() => { if (confirm("決算を取り消して再開放しますか？")) reopenMut.mutate(year); }}
                className="text-xs text-slate-400 hover:text-slate-600">再開放</button>
            </div>
          )}
        </div>
      </div>

      {isLoading ? (
        <div className="card py-16 text-center text-slate-400">読み込み中…</div>
      ) : !data ? (
        <div className="card py-16 text-center text-slate-400">データを取得できませんでした</div>
      ) : (
        <>
          {/* KPI カード */}
          <div className="grid grid-cols-4 gap-4 mb-6">
            <div className="card">
              <p className="text-xs font-medium text-slate-500 mb-1">収入合計</p>
              <p className="text-lg font-bold text-emerald-700">{yen(data.pnl.revenueTotal)}</p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-slate-500 mb-1">経費合計（按分後）</p>
              <p className="text-lg font-bold text-red-600">{yen(data.pnl.expenseDeductible)}</p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-slate-500 mb-1">事業所得</p>
              <p className={`text-lg font-bold ${data.pnl.netIncome >= 0 ? "text-indigo-700" : "text-red-600"}`}>
                {yen(data.pnl.netIncome)}
              </p>
            </div>
            <div className="card">
              <p className="text-xs font-medium text-slate-500 mb-1">純資産</p>
              <p className="text-lg font-bold text-slate-800">{yen(data.bs.equity)}</p>
            </div>
          </div>

          {/* タブ */}
          <div className="flex gap-1 mb-4 border-b border-slate-200">
            {TABS.map(t => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)}
                className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
                  tab === t.key
                    ? "border-indigo-500 text-indigo-700"
                    : "border-transparent text-slate-500 hover:text-slate-700"
                }`}>
                {t.label}
              </button>
            ))}
          </div>

          <div className="card">
            {tab === "pnl"     && <PnlTab pnl={data.pnl} />}
            {tab === "bs"      && <BsTab bs={data.bs} />}
            {tab === "trial"   && <TrialBalanceTab rows={data.trialBalance} />}
            {tab === "monthly" && <MonthlyTab monthly={data.monthly} fiscalYear={data.fiscalYear} />}
            {tab === "ratios"  && <RatiosTab ratios={data.ratios} bs={data.bs} pnl={data.pnl} />}
          </div>
        </>
      )}
    </AppShell>
  );
}
