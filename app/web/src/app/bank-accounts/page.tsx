"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";

type BankAccount = {
  id: number;
  name: string;
  bankName: string;
  branchName: string | null;
  accountType: string;
  accountNumber: string | null;
  balance: number;
  _count: { transactions: number };
};
type Tx = {
  id: number;
  date: string;
  description: string;
  amount: number;
  balance: number | null;
  category: string | null;
};
type FlowTransferRow = {
  id: number;
  from: string | null;
  to: string | null;
  amount: number;
  kind: string;
  channel: string;
  channelLabel: string;
  label: string | null;
  day: number;
  note: string | null;
};
type FlowResponse = { cyclic: boolean; transfers: FlowTransferRow[] };

const TYPE_LABEL: Record<string, string> = {
  ORDINARY: "普通預金",
  CURRENT: "当座預金",
  FIXED: "定期預金",
};
const yen = (v: number) => (v ?? 0).toLocaleString("ja-JP", { style: "currency", currency: "JPY" });

// ─── Flow Diagram ────────────────────────────────────────────────────────────

const SVG_W = 720;
const NODE_W = 148;
const NODE_H = 52;
const NODE_YGAP = 14;
const MARGIN_V = 44;
const COL_X = [12, (SVG_W - NODE_W) / 2, SVG_W - 12 - NODE_W] as const;

const STROKE_COLOR: Record<string, string> = {
  INCOME: "#10b981",
  BANK_TRANSFER: "#6366f1",
  AUTO_DEBIT: "#f59e0b",
  CARD_PAYMENT: "#f43f5e",
  EXPENSE: "#ef4444",
  DEFAULT: "#94a3b8",
};

function nid(name: string | null, label: string | null, side: "from" | "to") {
  return name ?? `外部（${label ?? (side === "from" ? "収入" : "支出")}）`;
}

function clip(s: string, n: number) {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function FlowDiagram({ transfers }: { transfers: FlowTransferRow[] }) {
  const { nodeMap, edges, svgHeight } = useMemo(() => {
    const fromSet = new Set(transfers.map((t) => nid(t.from, t.label, "from")));
    const toSet = new Set(transfers.map((t) => nid(t.to, t.label, "to")));
    const allIds = [...new Set([...fromSet, ...toSet])];

    const colOf = (id: string): 0 | 1 | 2 => {
      const isFrom = fromSet.has(id);
      const isTo = toSet.has(id);
      if (isFrom && !isTo) return 0;
      if (isTo && !isFrom) return 2;
      return 1;
    };

    const byCol: [string[], string[], string[]] = [[], [], []];
    for (const id of allIds) byCol[colOf(id)].push(id);

    const nodeMap = new Map<string, { col: number; x: number; y: number }>();
    for (let col = 0; col < 3; col++) {
      byCol[col].forEach((id, row) => {
        nodeMap.set(id, { col, x: COL_X[col], y: MARGIN_V + row * (NODE_H + NODE_YGAP) });
      });
    }

    const maxRows = Math.max(...[0, 1, 2].map((c) => byCol[c].length), 1);
    const svgHeight = MARGIN_V * 2 + maxRows * (NODE_H + NODE_YGAP) - NODE_YGAP + 8;

    const edges = transfers.map((t) => ({
      from: nid(t.from, t.label, "from"),
      to: nid(t.to, t.label, "to"),
      amount: t.amount,
      channelLabel: t.channelLabel,
      channel: t.channel,
      day: t.day,
    }));

    return { nodeMap, edges, svgHeight };
  }, [transfers]);

  const strokeKeys = [...new Set(["DEFAULT", ...Object.keys(STROKE_COLOR)])];

  return (
    <svg viewBox={`0 0 ${SVG_W} ${svgHeight}`} className="w-full" style={{ height: svgHeight }}>
      <defs>
        {strokeKeys.map((ch) => {
          const color = STROKE_COLOR[ch] ?? STROKE_COLOR.DEFAULT;
          return (
            <marker
              key={ch}
              id={`arr-${ch}`}
              markerWidth="7"
              markerHeight="7"
              refX="6"
              refY="3.5"
              orient="auto"
            >
              <polygon points="0 0, 7 3.5, 0 7" fill={color} opacity={0.85} />
            </marker>
          );
        })}
        <filter id="card-shadow" x="-10%" y="-20%" width="120%" height="140%">
          <feDropShadow dx="0" dy="1" stdDeviation="2" floodColor="#00000018" />
        </filter>
      </defs>

      {/* Column headers */}
      {(["収入元", "口座", "支出先"] as const).map((label, col) => (
        <text
          key={col}
          x={COL_X[col] + NODE_W / 2}
          y={22}
          textAnchor="middle"
          fontSize={10}
          fill="#94a3b8"
          fontFamily="system-ui, sans-serif"
          fontWeight={700}
          letterSpacing="0.08em"
        >
          {label.toUpperCase()}
        </text>
      ))}

      {/* Edges — draw first so nodes appear on top */}
      {edges.map((e, i) => {
        const fn = nodeMap.get(e.from);
        const tn = nodeMap.get(e.to);
        if (!fn || !tn) return null;

        const x1 = fn.x + NODE_W;
        const y1 = fn.y + NODE_H / 2;
        const x2 = tn.x;
        const y2 = tn.y + NODE_H / 2;
        const cx = (x1 + x2) / 2;
        const color = STROKE_COLOR[e.channel] ?? STROKE_COLOR.DEFAULT;
        const markerId = STROKE_COLOR[e.channel] ? e.channel : "DEFAULT";
        const midX = cx;
        const midY = (y1 + y2) / 2;

        return (
          <g key={i}>
            <path
              d={`M${x1},${y1} C${cx},${y1} ${cx},${y2} ${x2},${y2}`}
              fill="none"
              stroke={color}
              strokeWidth={2.5}
              strokeOpacity={0.6}
              markerEnd={`url(#arr-${markerId})`}
            />
            {/* Label pill */}
            <rect
              x={midX - 62}
              y={midY - 19}
              width={124}
              height={38}
              rx={6}
              fill="white"
              stroke="#e2e8f0"
              strokeWidth={1}
              filter="url(#card-shadow)"
            />
            <text
              x={midX}
              y={midY - 5}
              textAnchor="middle"
              fontSize={12}
              fill="#1e293b"
              fontFamily="system-ui, sans-serif"
              fontWeight={700}
            >
              ¥{e.amount.toLocaleString()}
            </text>
            <text
              x={midX}
              y={midY + 12}
              textAnchor="middle"
              fontSize={9.5}
              fill="#94a3b8"
              fontFamily="system-ui, sans-serif"
            >
              {e.channelLabel} · 毎月{e.day}日
            </text>
          </g>
        );
      })}

      {/* Nodes */}
      {[...nodeMap.entries()].map(([id, n]) => {
        const isExternal = id.startsWith("外部（");
        const fill = isExternal ? "#f8fafc" : "#eef2ff";
        const stroke = isExternal ? "#cbd5e1" : "#818cf8";
        const textColor = isExternal ? "#64748b" : "#3730a3";

        // Split label at "（" for two-line display
        const paren = id.indexOf("（");
        const lines =
          paren > 0 ? [clip(id.slice(0, paren), 10), clip(id.slice(paren), 10)] : [clip(id, 13)];

        return (
          <g key={id}>
            <rect
              x={n.x}
              y={n.y}
              width={NODE_W}
              height={NODE_H}
              rx={10}
              fill={fill}
              stroke={stroke}
              strokeWidth={1.5}
              filter="url(#card-shadow)"
            />
            {lines.length === 1 ? (
              <text
                x={n.x + NODE_W / 2}
                y={n.y + NODE_H / 2}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={12.5}
                fill={textColor}
                fontFamily="system-ui, sans-serif"
                fontWeight={600}
              >
                {lines[0]}
              </text>
            ) : (
              <>
                <text
                  x={n.x + NODE_W / 2}
                  y={n.y + NODE_H / 2 - 8}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={12}
                  fill={textColor}
                  fontFamily="system-ui, sans-serif"
                  fontWeight={600}
                >
                  {lines[0]}
                </text>
                <text
                  x={n.x + NODE_W / 2}
                  y={n.y + NODE_H / 2 + 9}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fontSize={10}
                  fill={textColor}
                  fontFamily="system-ui, sans-serif"
                >
                  {lines[1]}
                </text>
              </>
            )}
          </g>
        );
      })}
    </svg>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function BankAccountsPage() {
  const qc = useQueryClient();
  const [selected, setSelected] = useState<BankAccount | null>(null);
  const [showTxForm, setShowTxForm] = useState(false);
  const [txForm, setTxForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    description: "",
    amount: "",
  });

  const { data: accounts = [], isLoading } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async (): Promise<BankAccount[]> =>
      (await (await fetch("/api/bank-accounts")).json()).data ?? [],
  });

  const { data: txs = [], isLoading: loadingTx } = useQuery({
    queryKey: ["bank-txns", selected?.id],
    enabled: selected !== null,
    queryFn: async (): Promise<Tx[]> =>
      (await (await fetch(`/api/bank-accounts/${selected!.id}/transactions`)).json()).data ?? [],
  });

  const { data: flow } = useQuery({
    queryKey: ["transfer-flow"],
    queryFn: async (): Promise<FlowResponse> => {
      const res = await fetch("/api/transfers/flow");
      if (!res.ok) return { cyclic: false, transfers: [] };
      return res.json();
    },
  });

  const saveTx = async () => {
    if (!selected) return;
    const r = await fetch(`/api/bank-accounts/${selected.id}/transactions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...txForm, amount: Number(txForm.amount) }),
    });
    if (r.ok) {
      setShowTxForm(false);
      qc.invalidateQueries({ queryKey: ["bank-accounts"] });
      qc.invalidateQueries({ queryKey: ["bank-txns", selected.id] });
    }
  };

  return (
    <AppShell>
      <h1 className="page-title mb-6">銀行管理</h1>

      {/* 口座カード一覧 */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        {isLoading ? (
          <p className="col-span-3 text-slate-400 text-sm">読み込み中…</p>
        ) : (
          accounts.map((a) => (
            <button
              key={a.id}
              onClick={() => setSelected(a)}
              className={`p-4 rounded-xl border text-left transition-all ${selected?.id === a.id ? "border-indigo-400 bg-indigo-50" : "border-slate-200 bg-white hover:border-indigo-300"}`}
            >
              <div className="text-xs text-slate-500 mb-1">
                {a.bankName}
                {a.branchName ? " " + a.branchName : ""} /{" "}
                {TYPE_LABEL[a.accountType] ?? a.accountType}
              </div>
              <div className="font-semibold text-slate-800">{a.name}</div>
              <div className="text-lg font-bold text-indigo-600 mt-1">
                ¥{(a.balance ?? 0).toLocaleString()}
              </div>
              <div className="text-xs text-slate-400 mt-1">{a._count.transactions}件の取引</div>
            </button>
          ))
        )}
      </div>

      {/* 選択口座の取引履歴 */}
      {selected && (
        <div className="card overflow-hidden p-0 mb-6">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">{selected.name} — 取引履歴</h2>
            <button onClick={() => setShowTxForm(true)} className="btn-primary px-3 py-1.5 text-sm">
              入出金追加
            </button>
          </div>
          {loadingTx ? (
            <p className="px-5 py-4 text-slate-400 text-sm">読み込み中…</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {["日付", "摘要", "入出金", "残高", "カテゴリ"].map((h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-semibold text-slate-600"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {txs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-slate-400">
                      取引なし
                    </td>
                  </tr>
                ) : (
                  txs.map((tx) => (
                    <tr key={tx.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5 text-slate-500">{tx.date.slice(0, 10)}</td>
                      <td className="px-4 py-2.5">{tx.description}</td>
                      <td
                        className={`px-4 py-2.5 font-medium ${tx.amount >= 0 ? "text-emerald-600" : "text-red-600"}`}
                      >
                        {tx.amount >= 0 ? "+" : ""}¥{tx.amount.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-slate-400">
                        {tx.balance != null ? `¥${tx.balance.toLocaleString()}` : "—"}
                      </td>
                      <td className="px-4 py-2.5 text-slate-500 text-xs">{tx.category ?? "—"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* 口座間フロー */}
      <div className="card">
        <h2 className="section-title mb-4">資金移動</h2>
        {flow?.cyclic && (
          <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4">
            資金移動に循環があるためフロー図を描画できません。経路を見直してください。
          </p>
        )}
        {flow && !flow.cyclic && flow.transfers.length > 0 ? (
          <FlowDiagram transfers={flow.transfers} />
        ) : (
          !flow?.cyclic && (
            <p className="text-sm text-slate-400 py-10 text-center">
              固定の入出金を登録するとフロー図が表示されます。
            </p>
          )
        )}
      </div>

      {/* 入出金追加モーダル */}
      {showTxForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md">
            <h2 className="text-lg font-bold text-slate-800 mb-4">
              入出金追加（{selected?.name}）
            </h2>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">日付 *</label>
                <input
                  type="date"
                  value={txForm.date}
                  onChange={(e) => setTxForm((f) => ({ ...f, date: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">摘要 *</label>
                <input
                  value={txForm.description}
                  onChange={(e) => setTxForm((f) => ({ ...f, description: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-600 mb-1">
                  金額（入金=正、出金=負）*
                </label>
                <input
                  type="number"
                  value={txForm.amount}
                  onChange={(e) => setTxForm((f) => ({ ...f, amount: e.target.value }))}
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm"
                  placeholder="例: 100000 または -50000"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowTxForm(false)}
                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
              >
                キャンセル
              </button>
              <button
                onClick={saveTx}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
    </AppShell>
  );
}
