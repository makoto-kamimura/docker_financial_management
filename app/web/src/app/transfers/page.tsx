"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CashFlowSankey, type SankeyData } from "@/components/CashFlowSankey";

type BankAccount = { id: number; name: string; bankName: string; role: string };
type TransferRow = {
  id: number;
  from: string | null;
  to: string | null;
  amount: number;
  kind: "MANUAL" | "AUTO";
  channel: string;
  channelLabel: string;
  label: string | null;
  day: number;
  note: string | null;
};
type FlowResponse = { cyclic: boolean; graph: SankeyData; transfers: TransferRow[] };

const ROLES = [
  { value: "SALARY", label: "給与口座" },
  { value: "WITHDRAWAL", label: "引き落とし用" },
  { value: "SAVINGS", label: "貯蓄" },
  { value: "OTHER", label: "その他" },
];
const CHANNELS = [
  { value: "BANK_TRANSFER", label: "口座間振込" },
  { value: "AUTO_DEBIT", label: "口座引き落とし" },
  { value: "CARD_PAYMENT", label: "カード引き落とし" },
  { value: "INCOME", label: "入金（給与等）" },
  { value: "EXPENSE", label: "支出" },
];
const EXTERNAL = "__external__";
const yen = (v: number) => v.toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

export default function TransfersPage() {
  const qc = useQueryClient();

  const { data: accounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async (): Promise<BankAccount[]> =>
      (await (await fetch("/api/bank-accounts")).json()).data,
  });
  const { data: flow } = useQuery({
    queryKey: ["transfer-flow"],
    queryFn: async (): Promise<FlowResponse> => (await fetch("/api/transfers/flow")).json(),
  });

  const [acct, setAcct] = useState({ name: "", bankName: "", branchName: "", role: "OTHER" });
  const [tr, setTr] = useState({
    fromAccountId: "",
    toAccountId: "",
    amount: 0,
    kind: "AUTO",
    channel: "BANK_TRANSFER",
    label: "",
    day: 27,
    note: "",
  });

  // 出金元/入金先の値を口座ID or 外部(null)に変換
  const toAccountIdOrNull = (v: string) => (v === EXTERNAL || v === "" ? null : Number(v));

  async function addAccount(e: { preventDefault(): void }) {
    e.preventDefault();
    await fetch("/api/bank-accounts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(acct),
    });
    setAcct({ name: "", bankName: "", branchName: "", role: "OTHER" });
    qc.invalidateQueries({ queryKey: ["bank-accounts"] });
  }

  async function addTransfer(e: { preventDefault(): void }) {
    e.preventDefault();
    await fetch("/api/transfers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromAccountId: toAccountIdOrNull(tr.fromAccountId),
        toAccountId: toAccountIdOrNull(tr.toAccountId),
        amount: Number(tr.amount),
        kind: tr.kind,
        channel: tr.channel,
        label: tr.label || undefined,
        day: Number(tr.day),
        note: tr.note || undefined,
      }),
    });
    setTr({ fromAccountId: "", toAccountId: "", amount: 0, kind: "AUTO", channel: "BANK_TRANSFER", label: "", day: 27, note: "" });
    qc.invalidateQueries({ queryKey: ["transfer-flow"] });
  }

  return (
    <AppShell>
      <div className="mb-6">
        <h1 className="page-title">口座間 資金移動フロー</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          銀行口座と振込/引き落としを登録すると、資金の流れを自動でフロー図化します
        </p>
      </div>

      {/* フロー図 */}
      <div className="card mb-6">
        <h2 className="section-title">フロー図</h2>
        {flow?.cyclic && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-3">
            資金移動に循環があるためフロー図を描画できません。経路を見直してください。
          </p>
        )}
        {flow && !flow.cyclic && flow.graph.links.length > 0 ? (
          <CashFlowSankey data={flow.graph} />
        ) : (
          !flow?.cyclic && <p className="text-sm text-slate-400 py-6">振込/引き落としを登録すると表示されます。</p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* 口座登録 */}
        <div className="card">
          <h2 className="section-title">銀行口座を追加</h2>
          <form onSubmit={addAccount} className="space-y-3">
            <input className="input-field" placeholder="表示名（例: 給与口座）" value={acct.name}
              onChange={(e) => setAcct({ ...acct, name: e.target.value })} required />
            <input className="input-field" placeholder="銀行名" value={acct.bankName}
              onChange={(e) => setAcct({ ...acct, bankName: e.target.value })} required />
            <input className="input-field" placeholder="支店名（任意）" value={acct.branchName}
              onChange={(e) => setAcct({ ...acct, branchName: e.target.value })} />
            <select className="input-field" value={acct.role}
              onChange={(e) => setAcct({ ...acct, role: e.target.value })}>
              {ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
            <button type="submit" className="btn-primary w-full py-2">口座を追加</button>
          </form>
          <ul className="divide-y divide-slate-100 mt-4">
            {accounts?.map((a) => (
              <li key={a.id} className="flex items-center gap-2 py-2 text-sm">
                <span className="text-slate-800 flex-1">{a.name}</span>
                <span className="text-xs text-slate-500">{a.bankName}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600">
                  {ROLES.find((r) => r.value === a.role)?.label}
                </span>
              </li>
            ))}
          </ul>
        </div>

        {/* 振替登録 */}
        <div className="card">
          <h2 className="section-title">振込 / 引き落とし / 入金を追加</h2>
          <form onSubmit={addTransfer} className="space-y-3">
            <select className="input-field" value={tr.channel}
              onChange={(e) => setTr({ ...tr, channel: e.target.value })}>
              {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <div className="grid grid-cols-2 gap-2">
              <select className="input-field" value={tr.fromAccountId}
                onChange={(e) => setTr({ ...tr, fromAccountId: e.target.value })}>
                <option value="">出金元</option>
                <option value={EXTERNAL}>外部（給与等）</option>
                {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
              <select className="input-field" value={tr.toAccountId}
                onChange={(e) => setTr({ ...tr, toAccountId: e.target.value })}>
                <option value="">入金先</option>
                <option value={EXTERNAL}>外部（カード/支出）</option>
                {accounts?.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </div>
            <input className="input-field" placeholder="外部の名称（例: 給与、◯◯カード、家賃）" value={tr.label}
              onChange={(e) => setTr({ ...tr, label: e.target.value })} />
            <input className="input-field" type="number" placeholder="金額" value={tr.amount}
              onChange={(e) => setTr({ ...tr, amount: Number(e.target.value) })} required />
            <div className="grid grid-cols-2 gap-2">
              <select className="input-field" value={tr.kind}
                onChange={(e) => setTr({ ...tr, kind: e.target.value })}>
                <option value="AUTO">自動</option>
                <option value="MANUAL">手動</option>
              </select>
              <input className="input-field" type="number" min={1} max={31} placeholder="日(1-31)"
                value={tr.day} onChange={(e) => setTr({ ...tr, day: Number(e.target.value) })} required />
            </div>
            <input className="input-field" placeholder="メモ（任意）" value={tr.note}
              onChange={(e) => setTr({ ...tr, note: e.target.value })} />
            <button type="submit" className="btn-primary w-full py-2">追加</button>
          </form>
          <p className="text-xs text-slate-400 mt-2">
            出金元を「外部」にすると入金（給与）、入金先を「外部」にするとカード/口座引き落とし・支出になります。
          </p>
        </div>
      </div>

      {/* 振替一覧 */}
      {flow && flow.transfers.length > 0 && (
        <div className="card mt-6 overflow-hidden p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {["毎月", "チャネル", "出金元", "入金先", "金額", "種別", "メモ"].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-slate-600">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {flow.transfers.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 whitespace-nowrap">{t.day}日</td>
                  <td className="px-4 py-2.5 text-xs">{t.channelLabel}</td>
                  <td className="px-4 py-2.5">{t.from ?? <span className="text-slate-400">外部（{t.label ?? "入金"}）</span>}</td>
                  <td className="px-4 py-2.5">{t.to ?? <span className="text-slate-400">外部（{t.label ?? "支出"}）</span>}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{yen(t.amount)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${t.kind === "AUTO" ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-600"}`}>
                      {t.kind === "AUTO" ? "自動" : "手動"}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-slate-500 text-xs">{t.note ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AppShell>
  );
}
