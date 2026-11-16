import type { ShopChargeSummary } from "../api";

// 明細分け（通販の注文）に紐付いたカード・銀行の明細の、科目の欄の表示（web 版の ShopChargeBadge と同じ文言）
export function shopChargeLabel(c: ShopChargeSummary): string {
  return (
    `${c.shopName} の注文（商品 ${c.itemCount} 件` +
    (c.uncategorizedCount > 0 ? `・科目なし ${c.uncategorizedCount} 件` : "") +
    "）"
  );
}
