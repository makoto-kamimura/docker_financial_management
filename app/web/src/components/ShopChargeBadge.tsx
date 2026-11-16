"use client";

// 明細分け（通販の注文）に紐付いたカード・銀行の明細の「科目」の欄。紐付いた明細は商品ごとの行が実績になるので、
// 科目を選ぶ代わりに注文の要約を出し、押すと実績管理の履歴（出どころ: 明細分け）でその注文を開く。
import Link from "next/link";

/** 明細の応答に添えられる、紐付いた注文の要約（lib/ledger/ledger-entries.ts の ShopChargeSummary） */
export type ShopChargeSummary = {
  id: number;
  orderNo: string;
  shopName: string;
  itemCount: number;
  uncategorizedCount: number;
};

/** その注文を開く実績管理の履歴の URL */
export const shopOrderHref = (c: { orderNo: string }) =>
  `/entry?tab=history&source=shop&q=${encodeURIComponent(c.orderNo)}`;

export function ShopChargeBadge({ charge }: { charge: ShopChargeSummary }) {
  return (
    <Link
      href={shopOrderHref(charge) as never}
      className="inline-flex flex-col text-xs text-indigo-600 hover:text-indigo-800"
      title={`注文番号 ${charge.orderNo}`}
    >
      <span className="whitespace-nowrap">
        {charge.shopName} の注文（商品 {charge.itemCount} 件）
      </span>
      {charge.uncategorizedCount > 0 && (
        <span className="text-[11px] text-amber-600 whitespace-nowrap">
          科目なし {charge.uncategorizedCount} 件
        </span>
      )}
    </Link>
  );
}
