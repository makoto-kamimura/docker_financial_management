"use client";

// 実績管理の履歴（出どころは銀行）に置く「毎月の入出金」（資金移動ルール）の一覧。
// 銀行管理の資金移動スケジュールから移した。ルールは明細の「固定入出金」列や毎月の入出金の候補から登録し、
// ここでは一覧と削除を行う。残高の推移の見込みと、カード・電子マネー管理の引き落としの表示に使う。
// 一覧の元データは GET /api/transfers/flow の transfers、削除は DELETE /api/transfers/[id]。

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { SectionLead } from "@/components/Explain";
import { BANK_HELP } from "@/lib/help-texts";
import { yen } from "@/lib/format";

type TransferRow = {
  id: number;
  from: string | null;
  to: string | null;
  fromAccountId: number | null;
  toAccountId: number | null;
  amount: number;
  channelLabel: string;
  label: string | null;
  day: number;
};

type Props = {
  /** 選んだ銀行（null はすべての銀行） */
  accountId: number | null;
  /** 「振替を登録（銀行 → 銀行）」を押したとき（登録のモーダルは明細のパネルが持つ） */
  onRegisterTransfer: () => void;
};

export function TransferRulesCard({ accountId, onRegisterTransfer }: Props) {
  const qc = useQueryClient();
  const { data: flow } = useQuery({
    queryKey: ["transfer-flow"],
    queryFn: async (): Promise<{ transfers: TransferRow[] }> => {
      const res = await fetch("/api/transfers/flow");
      if (!res.ok) return { transfers: [] };
      return res.json();
    },
  });
  const { data: bankAccounts } = useQuery({
    queryKey: ["bank-accounts"],
    queryFn: async (): Promise<{ id: number }[]> =>
      (await (await fetch("/api/bank-accounts")).json()).data ?? [],
  });
  const rows = (flow?.transfers ?? []).filter(
    (t) => accountId === null || t.fromAccountId === accountId || t.toAccountId === accountId,
  );

  async function remove(t: TransferRow) {
    const name = t.label ?? `${t.from ?? "外部"} → ${t.to ?? "外部"}`;
    if (
      !confirm(
        `毎月${t.day}日の「${name}」の登録を解除しますか？取り込んだ明細はそのまま残ります。`,
      )
    )
      return;
    await fetch(`/api/transfers/${t.id}`, { method: "DELETE" });
    for (const key of [
      "transfers",
      "transfer-flow",
      "transfer-suggestions",
      "cash-outlook",
      "card-flow",
    ]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  }

  const canTransfer = (bankAccounts?.length ?? 0) >= 2;

  return (
    <section aria-labelledby="transfer-rules-title" className="card mb-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-2">
        <div>
          <h2 id="transfer-rules-title" className="section-title mb-1">
            毎月の入出金
          </h2>
          <SectionLead className="mb-0">{BANK_HELP.schedule}</SectionLead>
        </div>
        <button
          type="button"
          onClick={onRegisterTransfer}
          disabled={!canTransfer}
          className="btn-primary shrink-0"
          title={canTransfer ? undefined : "振替には 2 つ以上の口座の登録が必要です"}
        >
          振替を登録（銀行 → 銀行）
        </button>
      </div>
      {!flow ? (
        <p className="text-sm text-slate-400">読み込み中…</p>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">
          毎月の入出金はまだ登録されていません。下の明細の「固定入出金」列や、毎月の入出金の候補から登録できます。
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">毎月</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">移動元</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600 hidden sm:table-cell">
                  →
                </th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600">移動先</th>
                <th className="text-right px-3 py-2 font-semibold text-slate-600">金額</th>
                <th className="text-left px-3 py-2 font-semibold text-slate-600 hidden md:table-cell">
                  方式
                </th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-500 tabular-nums">{t.day}日</td>
                  <td className="px-3 py-2 text-slate-700">
                    {t.from ?? (
                      <span className="text-emerald-600 font-medium">{t.label ?? "外部入金"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-slate-400 hidden sm:table-cell">→</td>
                  <td className="px-3 py-2 text-slate-700">
                    {t.to ?? (
                      <span className="text-rose-600 font-medium">{t.label ?? "外部支出"}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-medium tabular-nums text-slate-900">
                    {yen(t.amount)}
                  </td>
                  <td className="px-3 py-2 text-slate-400 text-xs hidden md:table-cell">
                    {t.channelLabel}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => remove(t)}
                      className="text-xs text-slate-400 hover:text-red-600 whitespace-nowrap"
                    >
                      解除
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
