import { describe, expect, it } from "vitest";
import {
  findMerchant,
  findPaymentMethod,
  findReceiptDate,
  findReceiptTotal,
  findSelfMedication,
  normalizeOcrText,
  parseReceiptLines,
  parseReceiptText,
} from "./parse-receipt-text";

describe("normalizeOcrText", () => {
  it("全角を半角にし、日本語の文字のあいだの空白を詰める", () => {
    expect(normalizeOcrText("合 計　￥１ , ２８０")).toBe("合計 ¥1,280");
  });

  it("中国語の字体で読まれた字を日本語の字に戻す", () => {
    expect(normalizeOcrText("(8%对象 ¥630)\n(内消费税等 ¥46)\n綠茶")).toBe(
      "(8%対象 ¥630)\n(内消費税等 ¥46)\n緑茶",
    );
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
    ["26/10/1310:00 レジ0004", "2026-10-13"],
    ["2026/10/1310:00", "2026-10-13"],
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

  it.each(["お会計 ¥3,900", "ご請求額 ¥3,900", "お支払金額 ¥3,900", "領収金額 ¥3,900"])(
    "%s を合計とみなす",
    (line) => {
      expect(findReceiptTotal(["小計 ¥3,900", line].join("\n"))).toBe(3900);
    },
  );

  it("合計点数・残高の行は合計ではない", () => {
    expect(findReceiptTotal(["合計点数 5点", "残高 ¥4,337"].join("\n"))).toBeNull();
  });

  it("手がかりの行が無くても、お預り − お釣り を合計にする", () => {
    expect(findReceiptTotal(["小計 ¥1,096", "お預り ¥2,000", "お釣り ¥904"].join("\n"))).toBe(1096);
    expect(findReceiptTotal(["お預り ¥1,096", "お釣り ¥0"].join("\n"))).toBe(1096);
  });

  it("手がかりの行がいくつかあれば、お預り − お釣り と合う行を選ぶ", () => {
    const text = ["合計 ¥1,500", "お支払合計 ¥1,450", "お預り ¥2,000", "お釣り ¥550"].join("\n");
    expect(findReceiptTotal(text)).toBe(1450);
  });

  it("文字の高さが分かれば、大きい字の行を選ぶ", () => {
    const lines = [
      { text: "合計 ¥1,500", height: 24 },
      { text: "お支払合計 ¥1,450", height: 48 },
      { text: "クレジット ¥1,450", height: 24 },
    ];
    expect(findReceiptTotal(lines)).toBe(1450);
  });

  it("手がかりの行が無ければ、カード・電子マネーの支払いの金額", () => {
    expect(findReceiptTotal(["小計 ¥2,060", "楽天Edy支払 ¥2,060", "残高 ¥4,337"].join("\n"))).toBe(
      2060,
    );
  });
});

describe("findMerchant", () => {
  it("上のほうの、店名らしい最初の行を返す", () => {
    const text = ["領収書", "スーパーマルヤマ", "東京都千代田区1-2-3", "TEL 03-1234-5678"].join(
      "\n",
    );
    expect(findMerchant(text)).toBe("スーパーマルヤマ");
  });

  it("住所・電話・登録番号の行は店名にしない", () => {
    const text = ["東京都みどり区青葉6-5-16", "TEL 03-1234-5678", "登録番号 T1234567890123"];
    expect(findMerchant(text.join("\n"))).toBeNull();
  });

  it("文字の高さが分かれば、大きい字の行を選ぶ", () => {
    const lines = [
      { text: "いつもご利用ありがとう", height: 24 },
      { text: "ベーカリー麦の穂", height: 52 },
      { text: "駅前店", height: 24 },
      { text: "2026/04/24 11:44", height: 24 },
    ];
    expect(findMerchant(lines)).toBe("ベーカリー麦の穂");
  });

  it("店名の後ろの支店名は落とす（書店・本店のような店名の一部は残す）", () => {
    expect(findMerchant("スーパーみどり屋 中央店")).toBe("スーパーみどり屋");
    expect(findMerchant("青葉 書店")).toBe("青葉 書店");
    expect(findMerchant("カフェ ソレイユ")).toBe("カフェ ソレイユ");
  });
});

describe("findPaymentMethod", () => {
  it("カード・電子マネー・現金を見分ける", () => {
    expect(findPaymentMethod("クレジット VISA ¥1,000")).toBe("card");
    expect(findPaymentMethod("交通系電子マネー Suica")).toBe("emoney");
    expect(findPaymentMethod("お預り ¥2,000 お釣り ¥680")).toBe("cash");
    expect(findPaymentMethod("合計 ¥1,000")).toBe("unknown");
  });

  it("交通系 IC・QR コード決済は電子マネー", () => {
    expect(findPaymentMethod("交通系IC支払 ¥3,674")).toBe("emoney");
    expect(findPaymentMethod("PayPay ¥500")).toBe("emoney");
  });

  it("お預りとお釣りがあれば、下に決済の案内があっても現金", () => {
    expect(findPaymentMethod("お預り ¥1,000\nお釣り ¥120\nPayPay 使えます")).toBe("cash");
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
      selfMedicationTotal: null,
      paymentMethod: "cash",
    });
  });
});

describe("parseReceiptLines", () => {
  it("OCR サービスの行（文字の高さつき）から下書きを作る", () => {
    const lines = [
      { text: "領 収 証", height: 50 },
      { text: "ベーカリー麦の穂", height: 52 },
      { text: "駅前店", height: 24 },
      { text: "2026-04-24 11:44 レジ0007", height: 24 },
      { text: "カレーパン※ ¥240", height: 24 },
      { text: "小計（9点） ¥2,060", height: 24 },
      { text: "(8%对象 ¥2,060)", height: 24 },
      { text: "合 計 ￥2,060", height: 50 },
      { text: "楽天Edy支払 ¥2,060", height: 24 },
      { text: "残高 ¥4,337", height: 24 },
    ];
    expect(parseReceiptLines(lines)).toEqual({
      date: "2026-04-24",
      merchant: "ベーカリー麦の穂",
      total: 2060,
      items: [],
      selfMedicationTotal: null,
      paymentMethod: "emoney",
    });
  });
});

describe("医療の領収書", () => {
  const clinic = [
    { text: "領 収 証", height: 64 },
    { text: "患者番号 00123456 氏名 山田 太郎 様", height: 30 },
    { text: "生年月日 昭和55年4月1日", height: 26 },
    { text: "受診日 令和8年11月10日 负担割合 3割", height: 30 },
    { text: "初・再診料 医学管理等 在宅医療 検查 精神科専門療法", height: 26 },
    { text: "291点 225点", height: 30 },
    { text: "保険 合計点数 負担額 保険外負担", height: 26 },
    { text: "696点 2,090円 0円", height: 30 },
    { text: "今回領収額 2,090円", height: 44 },
    { text: "次回予約 令和8年11月24日 10:30 発行日 令和8年11月10日", height: 26 },
    { text: "医療法人社団 青葉会 みどりクリニック みど", height: 44 },
    { text: "東京都みどり区青葉1-2-3", height: 26 },
    { text: "TEL 03-1234-5678", height: 26 },
  ];

  it("下のほうの医療機関名・領収額・受診日を拾う（法人名・印の字・点数は除く）", () => {
    expect(parseReceiptLines(clinic)).toMatchObject({
      date: "2026-11-10",
      merchant: "みどりクリニック",
      total: 2090,
      paymentMethod: "unknown",
    });
  });

  it("生年月日・次回の予約の日付は使わない", () => {
    expect(
      findReceiptDate(["生年月日 2001年4月1日", "次回予約 2026/11/24", "2026/11/10"].join("\n")),
    ).toBe("2026-11-10");
  });

  it("点数は金額ではない", () => {
    expect(findReceiptTotal(["合計 696点"].join("\n"))).toBeNull();
  });

  it("金額が見出しの上の行に読まれても拾う", () => {
    expect(findReceiptTotal(["保険 合計点数 負担額", "970円", "領収金額"].join("\n"))).toBe(970);
  });

  it("空白が読めずに続いた法人名と印の字も落とす", () => {
    const lines = [
      { text: "調剤日 2026/11/10" },
      { text: "調剤技術料 薬学管理料 薬剤料" },
      { text: "医療法人若葉会わかば歯科クリニックわか" },
    ];
    expect(findMerchant(lines)).toBe("わかば歯科クリニック");
  });

  it("薬局の支店名を落とし、「朝日」「保険薬局」のような名前は残す", () => {
    expect(findMerchant(["調剤日 2026/11/10", "あおば薬局 中央店"].join("\n"))).toBe("あおば薬局");
    expect(findMerchant(["受診日 2026/11/10", "朝日クリニック"].join("\n"))).toBe("朝日クリニック");
    expect(findMerchant(["患者番号 123", "なのはな保険薬局"].join("\n"))).toBe("なのはな保険薬局");
  });

  it("医療の手がかりが無いレシートは、今までどおり上のほうの店名", () => {
    expect(findMerchant(["ドラッグひまわり", "駅前店", "合計 ¥1,280"].join("\n"))).toBe(
      "ドラッグひまわり",
    );
  });

  it("金額で終わる行は店名にしない（「100円ショップ」は店名）", () => {
    expect(findMerchant(["お支払額 180円", "100円ショップ ミナモ"].join("\n"))).toBe(
      "100円ショップ ミナモ",
    );
  });
});

describe("findSelfMedication", () => {
  it("注記のあるレシートで、印の付いた品目と対象額を拾う", () => {
    const raw = [
      "ドラッグストアミドリ",
      "2026年10月13日",
      "★ かぜ薬A ¥1,480",
      "ティッシュ ¥298",
      "★ 目薬B ¥980",
      "合計 ¥2,758",
      "★印はセルフメディケーション税制対象商品",
      "セルフメディケーション対象額 ¥2,460",
    ].join("\n");
    const d = parseReceiptText(raw);
    expect(d.items).toEqual([
      { name: "かぜ薬A", amount: 1480, selfMedication: true },
      { name: "目薬B", amount: 980, selfMedication: true },
    ]);
    expect(d.selfMedicationTotal).toBe(2460);
  });

  it("注記が無ければ印があっても拾わない", () => {
    expect(findSelfMedication("★ ポイント2倍 ¥100\n合計 ¥100")).toEqual({
      items: [],
      total: null,
    });
  });
});
