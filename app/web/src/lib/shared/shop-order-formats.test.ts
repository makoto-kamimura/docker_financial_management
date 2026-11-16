import { describe, it, expect } from "vitest";
import { amazonDate, convertAmazonOrderHistory } from "./shop-order-formats";

const HEADER =
  'ASIN,"Billing Address","Carrier Name & Tracking Number",Currency,Department,"Gift Message","Gift Recipient Contact","Gift Sender Name","Item Serial Number","Order Date","Order ID","Order Status","Original Quantity","Payment Method Type","Product Condition","Product Name","Purchase Order Number","Ship Date","Shipment Item Subtotal","Shipment Item Subtotal Tax","Shipment Status","Shipping Address","Shipping Charge","Shipping Option","Total Amount","Total Discounts","Unit Price","Unit Price Tax",Website';

// 列の並びは HEADER と同じ。住所などは空にした見本
const row = (o: {
  orderId: string;
  orderDate: string;
  shipDate: string;
  name: string;
  qty?: number;
  total: string;
  status?: string;
  currency?: string;
}) =>
  [
    "B000000000",
    '"住所"',
    "",
    o.currency ?? "JPY",
    "",
    "",
    "",
    "",
    "",
    o.orderDate,
    o.orderId,
    o.status ?? "Closed",
    String(o.qty ?? 1),
    "Visa - 1234",
    "New",
    `"${o.name}"`,
    "",
    o.shipDate,
    "",
    "",
    "Shipped",
    '"住所"',
    "0",
    "standard",
    o.total,
    "0",
    "",
    "",
    "Amazon.co.jp",
  ].join(",");

describe("amazonDate", () => {
  it("UTC の時刻つきは日本の日付に直す", () => {
    expect(amazonDate("2026-11-03T14:59:59Z")).toBe("2026-11-03");
    expect(amazonDate("2026-11-03T15:00:00.000Z")).toBe("2026-11-04");
    expect(amazonDate("2026-11-03T16:00:00")).toBe("2026-11-04"); // タイムゾーンなしは UTC
    expect(amazonDate("2026/11/3")).toBe("2026-11-03");
    expect(amazonDate("Not Available")).toBeNull();
    expect(amazonDate("")).toBeNull();
  });
});

describe("convertAmazonOrderHistory", () => {
  it("注文番号と発送日が同じ行を 1 つの請求にまとめ、金額は Total Amount の合計", () => {
    const csv = [
      HEADER,
      row({
        orderId: "250-1",
        orderDate: "2026-11-01T01:00:00Z",
        shipDate: "2026-11-02T03:00:00Z",
        name: "洗剤, 詰め替え",
        total: '"1,078"',
      }),
      row({
        orderId: "250-1",
        orderDate: "2026-11-01T01:00:00Z",
        shipDate: "2026-11-02T05:00:00Z",
        name: "文庫本",
        qty: 2,
        total: "1540",
      }),
      // 同じ注文の別の発送は別の請求
      row({
        orderId: "250-1",
        orderDate: "2026-11-01T01:00:00Z",
        shipDate: "2026-11-05T00:00:00Z",
        name: "電池",
        total: "698",
      }),
      row({
        orderId: "250-2",
        orderDate: "2026-11-03T00:00:00Z",
        shipDate: "Not Available",
        name: "未発送",
        total: "500",
      }),
      row({
        orderId: "250-3",
        orderDate: "2026-11-03T00:00:00Z",
        shipDate: "2026-11-04T00:00:00Z",
        name: "取消",
        total: "900",
        status: "Cancelled",
      }),
      row({
        orderId: "250-4",
        orderDate: "2026-11-03T00:00:00Z",
        shipDate: "2026-11-04T00:00:00Z",
        name: "外貨",
        total: "9",
        currency: "USD",
      }),
      row({
        orderId: "250-5",
        orderDate: "2026-11-03T00:00:00Z",
        shipDate: "2026-11-04T00:00:00Z",
        name: "無料",
        total: "0",
      }),
    ].join("\n");
    const result = convertAmazonOrderHistory(`﻿${csv}`);
    expect(result).not.toBeNull();
    expect(result!.charges).toEqual([
      {
        key: "250-1|2026-11-02",
        orderNo: "250-1",
        date: "2026-11-02",
        amount: 2_618,
        items: [
          { name: "洗剤, 詰め替え", quantity: 1, amount: 1_078 },
          { name: "文庫本", quantity: 2, amount: 1_540 },
        ],
      },
      {
        key: "250-1|2026-11-05",
        orderNo: "250-1",
        date: "2026-11-05",
        amount: 698,
        items: [{ name: "電池", quantity: 1, amount: 698 }],
      },
    ]);
    expect(result!.skipped).toEqual(
      expect.arrayContaining([
        { reason: "まだ発送されていない商品（請求前）", count: 1 },
        { reason: "取り消した注文", count: 1 },
        { reason: "円以外の通貨", count: 1 },
        { reason: "請求額が 0 円の発送（無料の商品など）", count: 1 },
      ]),
    );
  });

  it("旧い列名（Quantity・Total Owed）でも読む", () => {
    const csv = [
      '"Order ID","Order Date","Ship Date","Product Name","Quantity","Total Owed","Currency"',
      '"250-9","2026-10-01T00:00:00Z","2026-10-02T00:00:00Z","本","3","2,400","JPY"',
    ].join("\n");
    expect(convertAmazonOrderHistory(csv)!.charges).toEqual([
      {
        key: "250-9|2026-10-02",
        orderNo: "250-9",
        date: "2026-10-02",
        amount: 2_400,
        items: [{ name: "本", quantity: 3, amount: 2_400 }],
      },
    ]);
  });

  it("見出しが合わなければ null", () => {
    expect(convertAmazonOrderHistory("日付,摘要,金額\n2026/11/01,AMAZON,1000")).toBeNull();
  });
});
