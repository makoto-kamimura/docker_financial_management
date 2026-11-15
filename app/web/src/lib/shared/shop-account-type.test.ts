import { describe, it, expect } from "vitest";
import {
  matchesShopDescription,
  parseKeywordList,
  shopKeywords,
  shopOrderHistoryUrl,
} from "./shop-account-type";

describe("matchesShopDescription", () => {
  const amazon = { type: "AMAZON" };
  const rakuten = { type: "RAKUTEN" };
  const yodobashi = { type: "YODOBASHI" };

  it("Amazon の注文の支払いに当て、会費は外す", () => {
    expect(matchesShopDescription("AMAZON.CO.JP", amazon)).toBe(true);
    expect(matchesShopDescription("AMAZON.CO.JP 非接触", amazon)).toBe(true);
    expect(matchesShopDescription("ａｍａｚｏｎ．ｃｏ．ｊｐ", amazon)).toBe(true);
    expect(matchesShopDescription("AMAZON PRIME MEMBERSHI", amazon)).toBe(false);
    expect(matchesShopDescription("セブンイレブン", amazon)).toBe(false);
  });

  it("楽天市場は半角カナの店名にも当て、楽天モバイルは外す", () => {
    expect(matchesShopDescription("ﾗｸﾃﾝﾆｼﾞｭｳﾖﾝﾍﾟｯﾄｶﾝ", rakuten)).toBe(true);
    expect(matchesShopDescription("RAKUTEN24PETKAN", rakuten)).toBe(true);
    expect(matchesShopDescription("ﾔﾏｾｲﾗｸﾃﾝｲﾁﾊﾞﾃﾝ カード", rakuten)).toBe(true);
    expect(matchesShopDescription("RAKUTEN MOBILE USAGE", rakuten)).toBe(false);
    expect(matchesShopDescription("DF.ラクテンモバイル", rakuten)).toBe(false);
  });

  it("ヨドバシは英字と半角カナの両方に当てる", () => {
    expect(matchesShopDescription("YODOBASHI CAMERA WEB", yodobashi)).toBe(true);
    expect(matchesShopDescription("ﾖﾄﾞﾊﾞｼｶﾒﾗ ﾂｳｼﾝﾊﾝﾊﾞｲ(", yodobashi)).toBe(true);
  });

  it("登録したキーワードは既定より優先する", () => {
    const own = { type: "AMAZON", matchKeywords: ["AMZN"], excludeKeywords: [] };
    expect(matchesShopDescription("AMZN MKTP", own)).toBe(true);
    expect(matchesShopDescription("AMAZON.CO.JP", own)).toBe(false);
    // 除外は空なので既定（PRIME）が残る
    expect(shopKeywords(own).exclude).toEqual(["PRIME", "プライム"]);
  });

  it("その他の種類はキーワードを登録するまで何にも当たらない", () => {
    expect(matchesShopDescription("どこかの通販", { type: "OTHER" })).toBe(false);
  });
});

describe("shopOrderHistoryUrl", () => {
  it("登録した URL があればそれ、無ければ種類の既定", () => {
    expect(shopOrderHistoryUrl({ type: "AMAZON" })).toContain("amazon.co.jp");
    expect(shopOrderHistoryUrl({ type: "AMAZON", statementUrl: "https://example.com/x" })).toBe(
      "https://example.com/x",
    );
    expect(shopOrderHistoryUrl({ type: "OTHER" })).toBeNull();
  });
});

describe("parseKeywordList", () => {
  it("読点・カンマ・改行で区切り、空と重複を除く", () => {
    expect(parseKeywordList("AMAZON、アマゾン, AMAZON\n ,")).toEqual(["AMAZON", "アマゾン"]);
  });
});
