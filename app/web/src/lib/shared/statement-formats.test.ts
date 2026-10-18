import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Papa from "papaparse";
import { describe, expect, it } from "vitest";
import {
  convertStatement,
  decodeCsv,
  directionOf,
  headerCandidates,
  mappingFor,
  parseStatementAmount,
  StatementMappingSchema,
  parseStatementDate,
  toImportCsv,
} from "./statement-formats";

// 見本は実在の明細ではなく、よくある形（文字コード・見出しの前後の行・列名）をまねて作ったもの。
// card-vpass-sjis.csv（三井住友カード）と emoney-jalpay-utf8.csv（JAL Pay）は、実物の CSV の見出しと 1 行を
// もとに、氏名・番号を見本に替えたもの（JAL Pay のチャージと支払いの行は実物の形、取り消しと外貨の行は推測）。
// bank-mizuho-sjis.csv（みずほ銀行）は実物の見出しに、推測した行を付けたもの
const fixtureDir = resolve(dirname(fileURLToPath(import.meta.url)), "__fixtures__/statements");
const fixture = (name: string) => decodeCsv(readFileSync(resolve(fixtureDir, name)));

describe("decodeCsv", () => {
  it("Shift_JIS（CP932）を読む", () => {
    expect(fixture("bank-split-sjis.csv")).toContain("照会期間,2026年09月01日～2026年09月30日");
  });

  it("UTF-8 の BOM を除く", () => {
    expect(fixture("card-usage-utf8.csv").startsWith('"利用日"')).toBe(true);
  });
});

describe("parseStatementDate", () => {
  it.each([
    ["2026/10/1", "2026-10-01"],
    ["2026-10-01", "2026-10-01"],
    ["2026.10.01", "2026-10-01"],
    ["2026年10月1日", "2026-10-01"],
    ["20261001", "2026-10-01"],
    ["２０２６/１０/０１", "2026-10-01"],
    ["2026/09/07 12:34:56", "2026-09-07"],
    ["R8.10.1", "2026-10-01"],
    ["令和8年10月1日", "2026-10-01"],
    ["令和元年5月1日", "2019-05-01"],
    ["H31.4.30", "2019-04-30"],
    ["26/10/01", "2026-10-01"],
  ])("%s → %s", (raw, want) => {
    expect(parseStatementDate(raw)).toBe(want);
  });

  it("年の無い日付は、基準の日以前でいちばん近い年にする（基準が無ければ読まない）", () => {
    const ref = new Date(2026, 9, 18);
    expect(parseStatementDate("10/01", ref)).toBe("2026-10-01");
    expect(parseStatementDate("10月18日", ref)).toBe("2026-10-18");
    expect(parseStatementDate("12/28", ref)).toBe("2025-12-28");
    expect(parseStatementDate("10/01")).toBeNull();
  });

  it.each(["合計", "", "2026/02/30", "口座番号"])("%s は読めない", (raw) => {
    expect(parseStatementDate(raw)).toBeNull();
  });
});

describe("directionOf", () => {
  it.each([
    ["入金", 1],
    ["チャージ", 1],
    ["振込入金", 1],
    ["返金", 1],
    ["出金", -1],
    ["ATM出金", -1],
    ["お支払い", -1],
    ["ショッピング", -1],
    ["送金", -1],
  ])("%s → %d", (raw, want) => {
    expect(directionOf(raw)).toBe(want);
  });

  it.each(["", "両替", "振込", "支払取消", "入出金"])("%s は決めない", (raw) => {
    expect(directionOf(raw)).toBeNull();
  });
});

describe("parseStatementAmount", () => {
  it.each([
    ["1,980", 1980],
    ["¥1,980", 1980],
    ["１９８０円", 1980],
    ["-1980", -1980],
    ["△500", -500],
    ["▲500", -500],
  ])("%s → %d", (raw, want) => {
    expect(parseStatementAmount(raw)).toBe(want);
  });

  it.each(["", "-", "なし", undefined])("%s は null", (raw) => {
    expect(parseStatementAmount(raw)).toBeNull();
  });
});

describe("convertStatement", () => {
  it("見出しの前に口座の情報がある、出金・入金が別の列の銀行明細（Shift_JIS）", () => {
    const c = convertStatement(fixture("bank-split-sjis.csv"))!;
    expect(c.style).toBe("split");
    expect(c.rows).toEqual([
      { date: "2026-09-01", description: "カード セブン銀行", amount: -3000, balance: 120000 },
      { date: "2026-09-25", description: "振込 カ）テスト", amount: 250000, balance: 370000 },
    ]);
    // 末尾の合計の行は飛ばす
    expect(c.skipped).toEqual([{ text: "合計,250,000,3,000,,,", reason: "日付が読めない行" }]);
    expect(c.columns).toContainEqual({ role: "出金", names: ["払出金額（円）"] });
  });

  it("利用金額の列のカード明細は、利用を支出（負）にする", () => {
    const c = convertStatement(fixture("card-usage-utf8.csv"))!;
    expect(c.style).toBe("usage");
    expect(c.rows).toEqual([
      { date: "2026-09-05", description: "スーパーテスト", amount: -4320 },
      { date: "2026-09-06", description: "テスト電気", amount: -12800 },
    ]);
  });

  it("見出しの無いカード明細は 日付・摘要・金額 の並びで読み、返品は入金（正）になる", () => {
    const c = convertStatement(fixture("card-headerless-sjis.csv"))!;
    expect(c.headerless).toBe(true);
    expect(c.rows.map((r) => r.amount)).toEqual([-1980, -5400, 1980]);
    expect(c.rows[0].description).toBe("ＡＭＡＺＯＮ．ＣＯ．ＪＰ");
    expect(c.skipped).toHaveLength(2); // 氏名の行と合計の行
  });

  it("電子マネーの明細（摘要は 取引先 + 取引内容、「-」は空欄）", () => {
    const c = convertStatement(fixture("emoney-split-utf8.csv"))!;
    expect(c.rows).toEqual([
      { date: "2026-09-07", description: "コンビニテスト 支払い", amount: -550 },
      { date: "2026-09-08", description: "テスト銀行 チャージ", amount: 5000 },
    ]);
  });

  it("符号つきの 1 列（▲ も負）", () => {
    const c = convertStatement(fixture("bank-signed-sjis.csv"))!;
    expect(c.style).toBe("signed");
    expect(c.rows.map((r) => [r.amount, r.balance])).toEqual([
      [-12000, 88000],
      [-500, 87500],
      [30000, 117500],
    ]);
  });

  it("三井住友カード（Vpass）: 見出しの無いカード明細。利用が 1 件だけの月でも読み、氏名と合計の行は飛ばす", () => {
    const c = convertStatement(fixture("card-vpass-sjis.csv"))!;
    expect(c.headerless).toBe(true);
    expect(c.rows).toEqual([{ date: "2026-08-31", description: "タイムズカー", amount: -880 }]);
    expect(c.skipped.map((s) => s.reason)).toEqual(["日付が読めない行", "日付が読めない行"]);
  });

  it("みずほ銀行: お引出金額・お預入金額が別の列で、明細通番の列は読まない", () => {
    const c = convertStatement(fixture("bank-mizuho-sjis.csv"))!;
    expect(c.style).toBe("split");
    expect(c.rows).toEqual([
      { date: "2026-10-01", description: "ATM　テスト", amount: -3000, balance: 120000 },
      { date: "2026-10-05", description: "振込　カ）テスト", amount: 250000, balance: 370000 },
    ]);
    expect(c.columns).toEqual([
      { role: "日付", names: ["日付"] },
      { role: "摘要", names: ["お取引内容"] },
      { role: "出金", names: ["お引出金額"] },
      { role: "入金", names: ["お預入金額"] },
      { role: "残高", names: ["残高"] },
    ]);
  });

  it("JAL Pay: 符号つきの金額をそのまま読み、取り消し・円以外の行は飛ばす", () => {
    const c = convertStatement(fixture("emoney-jalpay-utf8.csv"))!;
    // 取引種別の列があっても、負の金額があるので符号のとおりに読む（「非接触」は向きの言葉ではない）
    expect(c.style).toBe("signed");
    expect(c.rows).toEqual([
      { date: "2026-10-18", description: "クレジットカード チャージ", amount: 5000 },
      { date: "2026-10-08", description: "テストスーパー　テスト店 非接触", amount: -416 },
    ]);
    expect(c.skipped.map((s) => s.reason)).toEqual(["取り消し・失敗の行", "円以外の通貨の行"]);
  });

  it("区分の列と符号の無い金額は、区分で向きを決め、向きの分からない行は飛ばす", () => {
    const c = convertStatement(
      "取引日,区分,金額,摘要\n2026/10/01,出金,3000,ATM\n2026/10/02,入金,5000,振込\n2026/10/03,両替,100,外貨",
    )!;
    expect(c.style).toBe("typed");
    expect(c.rows.map((r) => r.amount)).toEqual([-3000, 5000]);
    expect(c.skipped.map((s) => s.reason)).toEqual(["入金か出金か分からない行（両替）"]);
    expect(c.columns).toContainEqual({ role: "区分", names: ["区分"] });
  });

  it("年の無い日付は、見出しの前の日付（無ければ today）を基準に年を決める", () => {
    const titled = convertStatement(
      "照会日,2026/10/18\n日付,摘要,金額\n12/28,年末,-100\n10/01,今月,-200",
    )!;
    expect(titled.rows.map((r) => r.date)).toEqual(["2025-12-28", "2026-10-01"]);
    const plain = convertStatement("日付,摘要,金額\n12/28,年末,-100", {
      today: new Date(2027, 0, 5),
    })!;
    expect(plain.rows.map((r) => r.date)).toEqual(["2026-12-28"]);
  });

  it("見出しより列の多い行（カンマの入った金額が引用符で囲まれていない）は飛ばす", () => {
    const c = convertStatement("日付,摘要,金額\n2026/10/01,振込,5,000\n2026/10/02,振込,300")!;
    expect(c.rows.map((r) => r.amount)).toEqual([300]);
    expect(c.skipped[0].reason).toContain("見出しより列が多い行");
  });

  it("日付と金額の列が見つからなければ null", () => {
    expect(convertStatement("名前,メモ\nA,B\n")).toBeNull();
  });
});

describe("読み方（mapping）", () => {
  // 列名が候補に無く、自動では読めない明細
  const unknown = [
    "口座,テスト",
    "取扱年月日,中身,払った,もらった,のこり",
    "2026/10/01,ATM,3000,,97000",
    "2026/10/02,給与,,50000,147000",
  ].join("\n");

  it("自動で読めない明細は null。見出しの行の候補を返す", () => {
    expect(convertStatement(unknown)).toBeNull();
    expect(headerCandidates(unknown).map((c) => c.index)).toEqual([0, 1, 2, 3]);
  });

  it("読み方を渡すと、同じ見出しの行を探してその列で読む", () => {
    const mapping = mappingFor(["取扱年月日", "中身", "払った", "もらった", "のこり"], {
      date: 0,
      description: [1],
      withdrawal: 2,
      deposit: 3,
      usage: null,
      signed: null,
      kind: null,
      balance: 4,
    });
    const c = convertStatement(unknown, { mapping })!;
    expect(c.mapped).toBe(true);
    expect(c.style).toBe("split");
    expect(c.rows).toEqual([
      { date: "2026-10-01", description: "ATM", amount: -3000, balance: 97000 },
      { date: "2026-10-02", description: "給与", amount: 50000, balance: 147000 },
    ]);
    expect(c.mapping).toEqual(mapping);
  });

  it("見出しの違う CSV には読み方を使わず、自動で読む", () => {
    const mapping = mappingFor(["別の", "見出し"], {
      date: 0,
      description: [],
      withdrawal: null,
      deposit: null,
      usage: null,
      signed: 1,
      kind: null,
      balance: null,
    });
    const c = convertStatement(fixture("bank-signed-sjis.csv"), { mapping })!;
    expect(c.mapped).toBe(false);
    expect(c.rows).toHaveLength(3);
  });

  it("自動で読んだ明細も、読み方（画面の初めの値）を返す", () => {
    const c = convertStatement(fixture("bank-mizuho-sjis.csv"))!;
    expect(c.mapping).toEqual({
      header: ["明細通番", "日付", "お引出金額", "お預入金額", "残高", "お取引内容"],
      date: 1,
      description: [5],
      withdrawal: 2,
      deposit: 3,
      usage: null,
      signed: null,
      kind: null,
      balance: 4,
    });
    expect(convertStatement(fixture("card-vpass-sjis.csv"))!.mapping).toBeNull();
  });

  it("金額の列が無い・見出しに無い列の読み方は受け付けない", () => {
    const base = {
      header: ["a", "b"],
      date: 0,
      description: [1],
      withdrawal: null,
      deposit: null,
      usage: null,
      signed: null,
      kind: null,
      balance: null,
    };
    expect(StatementMappingSchema.safeParse(base).success).toBe(false);
    expect(StatementMappingSchema.safeParse({ ...base, signed: 5 }).success).toBe(false);
    expect(StatementMappingSchema.safeParse({ ...base, signed: 1 }).success).toBe(true);
  });
});

describe("toImportCsv", () => {
  it("アプリの形の CSV にし、摘要のカンマ・引用符も崩さない", () => {
    const csv = toImportCsv([
      { date: "2026-09-01", description: 'A,"B"', amount: -100, balance: 900 },
      { date: "2026-09-02", description: "C", amount: 50 },
    ]);
    const parsed = Papa.parse<Record<string, string>>(csv, { header: true });
    expect(parsed.data).toEqual([
      { 日付: "2026-09-01", 摘要: 'A,"B"', 金額: "-100", 残高: "900" },
      { 日付: "2026-09-02", 摘要: "C", 金額: "50", 残高: "" },
    ]);
  });
});

describe("アプリの形の CSV", () => {
  it("日付,摘要,金額,残高（日本語・英語）も、符号つきの金額の明細として読む", () => {
    const ja = convertStatement(
      "日付,摘要,金額,残高\n2026-10-01,給与,300000,512000\n2026-10-02,家賃,-80000,432000",
    );
    expect(ja?.style).toBe("signed");
    expect(ja?.rows).toEqual([
      { date: "2026-10-01", description: "給与", amount: 300000, balance: 512000 },
      { date: "2026-10-02", description: "家賃", amount: -80000, balance: 432000 },
    ]);
    const en = convertStatement("date,description,amount\n2026-10-03,AMAZON.CO.JP,-3980");
    expect(en?.rows).toEqual([{ date: "2026-10-03", description: "AMAZON.CO.JP", amount: -3980 }]);
  });
});
