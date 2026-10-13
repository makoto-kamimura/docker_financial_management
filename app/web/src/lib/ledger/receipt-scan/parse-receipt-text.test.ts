import { describe, expect, it } from "vitest";
import {
  findMerchant,
  findPaymentMethod,
  findReceiptDate,
  findReceiptTotal,
  normalizeOcrText,
  parseReceiptText,
} from "./parse-receipt-text";

describe("normalizeOcrText", () => {
  it("全角を半角にし、日本語の文字のあいだの空白を詰める", () => {
    expect(normalizeOcrText("合 計　￥１ , ２８０")).toBe("合計 ¥1,280");
  });
});

describe("findReceiptDate", () => {
  it.each([
    ["2026年10月13日(火) 12:34", "2026-10-13"],
    ["2026/10/3 12:34", "2026-10-03"],
    ["2026.10.13", "2026-10-13"],
    ["令和8年10月13日", "2026-10-13"],
    ["R8.10.13", "2026-10-13"],
    ["26/10/13 10:00", "2026-10-13"],
  ])("%s → %s", (text, expected) => {
    expect(findReceiptDate(text)).toBe(expected);
  });

  it("日付が無ければ null", () => {
    expect(findReceiptDate("合計 ¥1,280")).toBeNull();
  });
});

describe("findReceiptTotal", () => {
  it("合計の行の金額を返し、小計・お預り・お釣りは選ばない", () => {
    const text = [
      "小計 ¥1,200",
      "(10%対象 ¥1,200)",
      "合計 ¥1,320",
      "お預り ¥2,000",
      "お釣り ¥680",
    ].join("\n");
    expect(findReceiptTotal(text)).toBe(1320);
  });

  it("金額が次の行にあっても拾う", () => {
    expect(findReceiptTotal(["お買上計", "¥3,456"].join("\n"))).toBe(3456);
  });

  it("合計の手がかりが無ければ null", () => {
    expect(findReceiptTotal(["小計 ¥1,200", "お預り ¥2,000"].join("\n"))).toBeNull();
  });
});

describe("findMerchant", () => {
  it("上のほうの、店名らしい最初の行を返す", () => {
    const text = ["領収書", "スーパーマルヤマ", "東京都千代田区1-2-3", "TEL 03-1234-5678"].join(
      "\n",
    );
    expect(findMerchant(text)).toBe("スーパーマルヤマ");
  });
});

describe("findPaymentMethod", () => {
  it("カード・電子マネー・現金を見分ける", () => {
    expect(findPaymentMethod("クレジット VISA ¥1,000")).toBe("card");
    expect(findPaymentMethod("交通系電子マネー Suica")).toBe("emoney");
    expect(findPaymentMethod("お預り ¥2,000 お釣り ¥680")).toBe("cash");
    expect(findPaymentMethod("合計 ¥1,000")).toBe("unknown");
  });

  it("ポイントカードは支払方法とみなさない", () => {
    expect(findPaymentMethod("ポイントカード 123点\nお預り ¥2,000")).toBe("cash");
  });
});

describe("parseReceiptText", () => {
  it("OCR の文字から下書きを作る（品目は拾わない）", () => {
    const raw = [
      "コ ン ビ ニ マ ー ト",
      "東 京 駅 前 店",
      "2026年 10月 13日 (火) 08:15",
      "お に ぎ り ¥150",
      "合 計 ¥ 1 , 280",
      "現 金 ¥ 2 , 000",
      "お 釣 り ¥720",
    ].join("\n");
    expect(parseReceiptText(raw)).toEqual({
      date: "2026-10-13",
      merchant: "コンビニマート",
      total: 1280,
      items: [],
      paymentMethod: "cash",
    });
  });
});
