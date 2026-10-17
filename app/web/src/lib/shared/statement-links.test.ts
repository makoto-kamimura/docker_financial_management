import { describe, expect, it } from "vitest";
import { presetStatementLink, statementLinkFor, statementUrlInput } from "./statement-links";

describe("presetStatementLink", () => {
  it("銀行名から既定のログイン入口を返す", () => {
    expect(presetStatementLink("BANK", "三菱UFJ銀行")?.url).toBe("https://direct.bk.mufg.jp/");
    expect(presetStatementLink("BANK", "ゆうちょ銀行")?.siteName).toBe("ゆうちょダイレクト");
  });

  it("三井住友は銀行とカードで別のサイト", () => {
    expect(presetStatementLink("BANK", "三井住友銀行")?.siteName).toBe("SMBCダイレクト");
    expect(presetStatementLink("CARD", "三井住友カード")?.siteName).toBe("Vpass（三井住友カード）");
  });

  it("楽天は銀行とカードで別のサイト", () => {
    expect(presetStatementLink("BANK", "楽天銀行")?.siteName).toBe("楽天銀行");
    expect(presetStatementLink("CARD", "楽天カード")?.siteName).toBe("楽天e-NAVI");
  });

  it("全角英字・空白・大文字小文字の揺れを吸収する", () => {
    expect(presetStatementLink("BANK", "住信ＳＢＩ ネット銀行")?.siteName).toBe(
      "住信SBIネット銀行",
    );
    expect(presetStatementLink("CARD", "paypay")?.siteName).toBe("PayPay");
  });

  it("アプリでしか明細を見られないものは URL なしで案内文を返す", () => {
    const link = presetStatementLink("CARD", "PayPay");
    expect(link?.url).toBeNull();
    expect(link?.note).toContain("取引履歴");
  });

  it("表に無い金融機関・空欄は null", () => {
    expect(presetStatementLink("BANK", "どこかの信用金庫")).toBeNull();
    expect(presetStatementLink("CARD", "  ")).toBeNull();
  });
});

describe("statementLinkFor", () => {
  it("登録した URL を既定より優先する", () => {
    expect(
      statementLinkFor("BANK", {
        statementUrl: " https://example.com/login ",
        institution: "三菱UFJ銀行",
      }),
    ).toEqual({ url: "https://example.com/login", siteName: null });
  });

  it("URL が空なら金融機関名から既定を使う", () => {
    expect(statementLinkFor("CARD", { statementUrl: "", institution: "楽天カード" })?.url).toBe(
      "https://www.rakuten-card.co.jp/e-navi/",
    );
    expect(statementLinkFor("BANK", { statementUrl: null, institution: "地方銀行" })).toBeNull();
  });
});

describe("statementUrlInput", () => {
  it("https の URL を受け、空欄は null、省略は undefined", () => {
    expect(statementUrlInput.parse(" https://example.com/a ")).toBe("https://example.com/a");
    expect(statementUrlInput.parse("")).toBeNull();
    expect(statementUrlInput.parse(null)).toBeNull();
    expect(statementUrlInput.parse(undefined)).toBeUndefined();
  });

  it("http や URL でない文字列は受けない", () => {
    expect(statementUrlInput.safeParse("http://example.com").success).toBe(false);
    expect(statementUrlInput.safeParse("javascript:alert(1)").success).toBe(false);
    expect(statementUrlInput.safeParse("example.com").success).toBe(false);
  });
});
