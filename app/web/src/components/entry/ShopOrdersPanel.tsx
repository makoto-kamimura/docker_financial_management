"use client";

// 実績管理の「履歴」の出どころ「明細分け」。明細管理で登録した明細分け（Amazon など）に取り込んだ注文を、
// 請求ごとに並べる。商品ごとに科目・事業利用を付け（商品名で学習する）、カード・銀行の明細に紐付ける。
// 紐付けた明細は科目が外れ、商品ごとの行が実績になる（lib/ledger/shop-link.ts）。
// 自動で紐付かなかった請求は「明細を選ぶ」で、金額と日付の近い候補から手で紐付ける（金額の差は商品の金額の割合で割り振る）。
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Modal } from "@/components/Modal";
import { LoadingSpinner } from "@/components/StateViews";
import { InfoNote } from "@/components/Explain";
import { Notice, Pager } from "@/components/ui";
import { LedgerBadge, LedgerFilter } from "@/components/LedgerTable";
import { BusinessCell } from "@/components/ActualsConfirmPanel";
import { invalidateActuals } from "@/lib/client/invalidate-actuals";
import { useViewMode } from "@/lib/client/use-view-mode";
import { yen } from "@/lib/common/format";
import { displayName, type ViewMode } from "@/lib/shared/display-name";
import { SHOP_HELP } from "@/lib/shared/help-texts";

type CategoryAccount = {
  id: number;
  code: string;
  name: string;
  category: string;
  soleName?: string | null;
  corporateName?: string | null;
};

type ShopItem = {
  id: number;
  name: string;
  quantity: number;
  amount: number;
  /** 明細に紐付いていれば、明細の金額に合わせて割り振った額 */
  allocatedAmount: number | null;
  categoryAccountId: number | null;
  businessUse: boolean;
  businessRatio: number | null;
};

type ShopCharge = {
  id: number;
  shopAccount: { id: number; name: string; type: string };
  orderNo: string;
  date: string;
  amount: number;
  sellerName: string | null;
  linkedBy: "AUTO" | "MANUAL" | null;
  entry: {
    id: number;
    kind: "BANK" | "CARD" | "CASH";
    date: string | null;
    description: string | null;
    /** +入金 / −出金 */
    amount: number;
    sourceName: string;
  } | null;
  items: ShopItem[];
  uncategorizedCount: number;
};

type ListResponse = { data: ShopCharge[]; total: number; limit: number; offset: number };

type Candidate = {
  id: number;
  kind: "BANK" | "CARD";
  date: string;
  description: string;
  amount: number;
  sourceName: string;
  categoryAccount: { id: number; code: string; name: string } | null;
  dayGap: number;
  amountGap: number;
  keywordMatch: boolean;
};

export type ShopOrderStatus = "all" | "unlinked" | "uncategorized";
const STATUS_FILTERS: [ShopOrderStatus, string][] = [
  ["all", "全件"],
  ["unlinked", "未紐付け"],
  ["uncategorized", "科目なしあり"],
];

const PAGE_SIZE = 20;
const fmtYmd = (ymd: string) => ymd.replaceAll("-", "/");

/** 紐付け・科目の変更のあとに取り直すもの（明細の一覧・未割り当て・実績） */
function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const key of [
      "shop-orders",
      "shop-accounts",
      "card-txns",
      "bank-txns",
      "ledger-unassigned",
    ]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
    invalidateActuals(qc);
  };
}

async function errorOf(res: Response, fallback: string) {
  const j = await res.json().catch(() => null);
  return (j?.error as string | undefined) ?? fallback;
}

export function ShopOrdersPanel({
  shopAccountId,
  initialQuery = "",
  initialStatus = "all",
}: {
  /** 明細分け（null はすべて） */
  shopAccountId: number | null;
  /** 最初の検索の語（カードの明細の「Amazon の注文」から開くときは注文番号） */
  initialQuery?: string;
  initialStatus?: ShopOrderStatus;
}) {
  const mode = useViewMode();
  const refresh = useRefresh();
  const [status, setStatus] = useState<ShopOrderStatus>(initialStatus);
  const [q, setQ] = useState(initialQuery);
  const [query, setQuery] = useState(initialQuery);
  const [offset, setOffset] = useState(0);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [linking, setLinking] = useState<ShopCharge | null>(null);
  const [busy, setBusy] = useState(false);

  // 明細分け・絞り込みを替えたら 1 ページ目に戻す
  const pageKey = `${shopAccountId}:${status}:${query}`;
  const [shownKey, setShownKey] = useState(pageKey);
  if (shownKey !== pageKey) {
    setShownKey(pageKey);
    setOffset(0);
  }

  const { data, isLoading } = useQuery({
    queryKey: ["shop-orders", shopAccountId, status, query, offset],
    queryFn: async (): Promise<ListResponse> => {
      const params = new URLSearchParams({
        status,
        limit: String(PAGE_SIZE),
        offset: String(offset),
      });
      if (shopAccountId) params.set("shopAccountId", String(shopAccountId));
      if (query) params.set("q", query);
      const res = await fetch(`/api/shop-orders?${params}`);
      if (!res.ok) throw new Error(await errorOf(res, "注文の取得に失敗しました"));
      return res.json();
    },
  });
  const { data: accounts } = useQuery({
    queryKey: ["accounts"],
    queryFn: async (): Promise<CategoryAccount[]> =>
      (await (await fetch("/api/accounts")).json()).data ?? [],
  });
  const categorizable = (accounts ?? []).filter((a) =>
    ["REVENUE", "COGS", "EXPENSE"].includes(a.category),
  );

  async function autoLink() {
    setBusy(true);
    try {
      const res = await fetch("/api/shop-orders/auto-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(shopAccountId ? { shopAccountId } : {}),
      });
      if (!res.ok) {
        setMsg({ ok: false, text: await errorOf(res, "自動の紐付けに失敗しました") });
        return;
      }
      const { linked } = (await res.json()) as { linked: number };
      setMsg({
        ok: true,
        text:
          linked > 0
            ? `${linked} 件の注文を明細に紐付けました。`
            : "自動で紐付けられる注文はありませんでした（金額と日付が合い、相手が 1 つに決まるものだけを紐付けます）。",
      });
      refresh();
    } finally {
      setBusy(false);
    }
  }

  async function updateItem(
    item: ShopItem,
    change: {
      categoryAccountId?: number | null;
      businessUse?: boolean;
      businessRatio?: number | null;
    },
  ) {
    const res = await fetch(`/api/shop-orders/items/${item.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      // 科目を選んだときは商品名で学習する
      body: JSON.stringify({ ...change, ...(change.categoryAccountId ? { learn: true } : {}) }),
    });
    if (!res.ok) {
      setMsg({ ok: false, text: await errorOf(res, "保存に失敗しました") });
      return;
    }
    refresh();
  }

  async function unlink(c: ShopCharge) {
    if (!confirm(`注文 ${c.orderNo} の紐付けを外しますか？明細は未割り当てに戻ります。`)) return;
    const res = await fetch(`/api/shop-orders/${c.id}/link`, { method: "DELETE" });
    if (!res.ok) {
      setMsg({ ok: false, text: await errorOf(res, "紐付けを外せませんでした") });
      return;
    }
    refresh();
  }

  async function remove(c: ShopCharge) {
    if (
      !confirm(
        `注文 ${c.orderNo} を削除しますか？商品も一緒に消えます。${c.entry ? "紐付けた明細は未割り当てに戻ります。" : ""}`,
      )
    )
      return;
    const res = await fetch(`/api/shop-orders/${c.id}`, { method: "DELETE" });
    if (!res.ok) {
      setMsg({ ok: false, text: await errorOf(res, "削除に失敗しました") });
      return;
    }
    refresh();
  }

  return (
    <div>
      <InfoNote className="mb-3">{SHOP_HELP.history}</InfoNote>
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <LedgerFilter options={STATUS_FILTERS} value={status} onChange={setStatus} />
        <form
          onSubmit={(ev) => {
            ev.preventDefault();
            setQuery(q.trim());
          }}
          className="flex items-center gap-1"
        >
          <input
            value={q}
            onChange={(ev) => setQ(ev.target.value)}
            placeholder="注文番号・商品名"
            aria-label="注文番号・商品名で探す"
            className="input-field h-8 w-52 text-xs"
          />
          <button type="submit" className="btn-secondary btn-sm">
            探す
          </button>
          {query && (
            <button
              type="button"
              onClick={() => {
                setQ("");
                setQuery("");
              }}
              className="text-xs text-slate-400 hover:text-slate-600"
            >
              クリア
            </button>
          )}
        </form>
        <span className="text-xs text-slate-500">{data ? `${data.total} 件` : ""}</span>
        <button
          type="button"
          onClick={autoLink}
          disabled={busy}
          className="btn-secondary btn-sm ml-auto"
          title={SHOP_HELP.autoLink}
        >
          自動で紐付ける
        </button>
      </div>

      {msg && (
        <Notice tone={msg.ok ? "success" : "error"} onClose={() => setMsg(null)} className="mb-3">
          {msg.text}
        </Notice>
      )}

      {isLoading ? (
        <LoadingSpinner />
      ) : (data?.data ?? []).length === 0 ? (
        <p className="text-sm text-slate-500 py-6 text-center">
          {query || status !== "all"
            ? "この条件に一致する注文はありません"
            : "注文がありません。実績管理の「取り込み」で注文の CSV を取り込みます。"}
        </p>
      ) : (
        <div className="space-y-3">
          {data!.data.map((c) => (
            <ChargeCard
              key={c.id}
              charge={c}
              mode={mode}
              categorizable={categorizable}
              onLink={() => setLinking(c)}
              onUnlink={() => unlink(c)}
              onRemove={() => remove(c)}
              onItemChange={updateItem}
            />
          ))}
        </div>
      )}

      {data && data.total > PAGE_SIZE && (
        <Pager
          offset={offset}
          pageSize={PAGE_SIZE}
          total={data.total}
          onChange={setOffset}
          className="mt-4"
        />
      )}

      {linking && (
        <LinkModal
          charge={linking}
          onClose={() => setLinking(null)}
          onLinked={() => {
            setLinking(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}

function ChargeCard({
  charge: c,
  mode,
  categorizable,
  onLink,
  onUnlink,
  onRemove,
  onItemChange,
}: {
  charge: ShopCharge;
  mode: ViewMode;
  categorizable: CategoryAccount[];
  onLink: () => void;
  onUnlink: () => void;
  onRemove: () => void;
  onItemChange: (
    item: ShopItem,
    change: {
      categoryAccountId?: number | null;
      businessUse?: boolean;
      businessRatio?: number | null;
    },
  ) => void;
}) {
  const showBusiness = mode === "sole";
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 flex flex-wrap items-start justify-between gap-3 border-b border-slate-100">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm font-medium text-slate-800 tabular-nums">
              {fmtYmd(c.date)}
            </span>
            <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full">
              {c.shopAccount.name}
            </span>
            {c.sellerName && <span className="text-xs text-slate-500">{c.sellerName}</span>}
            <span className="text-xs text-slate-400">注文番号 {c.orderNo}</span>
          </div>
          <div className="mt-1 text-xs text-slate-600">
            {c.entry ? (
              <>
                紐付け先: {c.entry.sourceName}・{c.entry.date ? fmtYmd(c.entry.date) : ""}・
                {c.entry.description}・{yen(Math.abs(c.entry.amount))}
                <LedgerBadge tone="slate">{c.linkedBy === "AUTO" ? "自動" : "手動"}</LedgerBadge>
                {Math.abs(c.entry.amount) !== c.amount && (
                  <span className="ml-1 text-amber-600">
                    （請求額との差 {yen(Math.abs(c.entry.amount) - c.amount)}{" "}
                    は商品の金額の割合で割り振り）
                  </span>
                )}
              </>
            ) : (
              <span className="text-amber-700">カード・銀行の明細に紐付いていません</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="text-right">
            <p className="text-[10px] text-slate-400">請求額</p>
            <p className="font-bold text-rose-600 text-sm tabular-nums">{yen(c.amount)}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            {c.entry ? (
              <button
                type="button"
                onClick={onUnlink}
                className="text-xs text-slate-500 hover:text-red-600"
              >
                紐付けを外す
              </button>
            ) : (
              <button
                type="button"
                onClick={onLink}
                className="text-xs text-indigo-600 hover:text-indigo-800"
              >
                明細を選ぶ
              </button>
            )}
            <button
              type="button"
              onClick={onRemove}
              className="text-xs text-red-400 hover:text-red-600"
            >
              削除
            </button>
          </div>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 text-xs text-slate-600">
              <th className="px-4 py-1.5 text-left font-semibold min-w-52">商品</th>
              <th className="px-3 py-1.5 text-right font-semibold">金額</th>
              <th className="px-3 py-1.5 text-left font-semibold">科目</th>
              {showBusiness && (
                <th className="px-3 py-1.5 text-left font-semibold">事業利用・按分</th>
              )}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {c.items.map((i) => (
              <tr key={i.id}>
                <td className="px-4 py-1.5">
                  {i.name}
                  {i.quantity > 1 && <span className="text-xs text-slate-400"> ×{i.quantity}</span>}
                </td>
                <td className="px-3 py-1.5 text-right whitespace-nowrap tabular-nums">
                  {yen(i.allocatedAmount ?? i.amount)}
                  {i.allocatedAmount !== null && i.allocatedAmount !== i.amount && (
                    <span className="block text-[10px] text-slate-400">
                      商品の金額 {yen(i.amount)}
                    </span>
                  )}
                </td>
                <td className="px-3 py-1.5">
                  <select
                    value={i.categoryAccountId ?? ""}
                    onChange={(ev) =>
                      onItemChange(i, {
                        categoryAccountId: ev.target.value === "" ? null : Number(ev.target.value),
                      })
                    }
                    aria-label={`${i.name} の科目`}
                    className={`text-xs border rounded px-1.5 py-1 bg-white min-w-40 ${
                      i.categoryAccountId === null ? "border-amber-300" : "border-slate-200"
                    }`}
                  >
                    <option value="">科目なし</option>
                    {categorizable.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.code} {displayName(a, mode)}
                      </option>
                    ))}
                  </select>
                </td>
                {showBusiness && (
                  <td className="px-3 py-1.5">
                    <BusinessCell
                      entry={{
                        description: i.name,
                        businessUse: i.businessUse,
                        businessRatio: i.businessRatio,
                      }}
                      onChange={(change) => onItemChange(i, change)}
                    />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// 手での紐付け。請求日の前後 14 日の出金の明細を、金額の差の小さい順に出す
function LinkModal({
  charge,
  onClose,
  onLinked,
}: {
  charge: ShopCharge;
  onClose: () => void;
  onLinked: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const { data, isLoading } = useQuery({
    queryKey: ["shop-order-candidates", charge.id],
    queryFn: async (): Promise<Candidate[]> => {
      const res = await fetch(`/api/shop-orders/${charge.id}/candidates`);
      if (!res.ok) throw new Error(await errorOf(res, "候補の取得に失敗しました"));
      return (await res.json()).data ?? [];
    },
  });

  async function link(entryId: number) {
    setError(null);
    const res = await fetch(`/api/shop-orders/${charge.id}/link`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ entryId }),
    });
    if (!res.ok) {
      setError(await errorOf(res, "紐付けに失敗しました"));
      return;
    }
    onLinked();
  }

  return (
    <Modal size="xl" onClose={onClose}>
      <h2 className="text-lg font-bold text-slate-800 mb-1">明細を選ぶ</h2>
      <p className="text-xs text-slate-500 mb-3">
        {charge.shopAccount.name}・注文番号 {charge.orderNo}・{fmtYmd(charge.date)}・請求額{" "}
        {yen(charge.amount)}。{SHOP_HELP.candidates}
      </p>
      {error && (
        <Notice tone="error" className="mb-3">
          {error}
        </Notice>
      )}
      {isLoading ? (
        <LoadingSpinner />
      ) : (data ?? []).length === 0 ? (
        <p className="text-sm text-slate-500 py-4">
          紐付けられる明細が見つかりません（請求日の前後 14
          日の、銀行・カードの出金の明細から探します）。
        </p>
      ) : (
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-y border-slate-200 text-xs text-slate-600">
                <th className="px-3 py-2 text-left font-semibold">日付</th>
                <th className="px-3 py-2 text-left font-semibold">口座・カード</th>
                <th className="px-3 py-2 text-left font-semibold">摘要</th>
                <th className="px-3 py-2 text-right font-semibold">金額</th>
                <th className="px-3 py-2 text-left font-semibold">差</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(data ?? []).map((e) => (
                <tr key={e.id}>
                  <td className="px-3 py-2 whitespace-nowrap tabular-nums">{fmtYmd(e.date)}</td>
                  <td className="px-3 py-2 text-xs text-slate-600 whitespace-nowrap">
                    {e.sourceName}
                  </td>
                  <td className="px-3 py-2">
                    {e.description}
                    {e.categoryAccount && (
                      <span className="block text-[11px] text-slate-400">
                        いまの科目: {e.categoryAccount.name}（紐付けると外れます）
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap tabular-nums">
                    {yen(Math.abs(e.amount))}
                  </td>
                  <td className="px-3 py-2 text-xs whitespace-nowrap">
                    <span className={e.amountGap === 0 ? "text-emerald-600" : "text-amber-600"}>
                      {e.amountGap === 0
                        ? "金額一致"
                        : `金額 ${e.amountGap > 0 ? "+" : ""}${yen(e.amountGap)}`}
                    </span>
                    <span className="text-slate-400">
                      {" "}
                      ・
                      {e.dayGap === 0
                        ? "同じ日"
                        : `${Math.abs(e.dayGap)} 日${e.dayGap > 0 ? "後" : "前"}`}
                    </span>
                    {e.keywordMatch && <LedgerBadge tone="emerald">摘要一致</LedgerBadge>}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => link(e.id)}
                      className="btn-primary btn-sm whitespace-nowrap"
                    >
                      紐付ける
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-end mt-4">
        <button
          onClick={onClose}
          className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg"
        >
          閉じる
        </button>
      </div>
    </Modal>
  );
}
