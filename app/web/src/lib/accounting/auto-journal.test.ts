import { describe, it, expect } from "vitest";
import {
  buildAutoBook,
  buildLedgers,
  buildTrialBalance,
  type AutoBook,
  type AutoBookInput,
  type AutoEntryInput,
  type MoneySource,
} from "./auto-journal";

const tel = { id: 1, code: "7000", name: "通信費", category: "EXPENSE" };
const sales = { id: 2, code: "4000", name: "売上", category: "REVENUE" };
const depr = { id: 3, code: "7600", name: "減価償却費", category: "EXPENSE" };
const accum = { id: 4, code: "1700", name: "減価償却累計額", category: "ASSET" };
const ar = { id: 5, code: "1300", name: "売掛金", category: "ASSET" };
const deposit = { id: 6, code: "1100", name: "普通預金", category: "ASSET" };
const stock = { id: 7, code: "1400", name: "棚卸資産", category: "ASSET" };
const cogs = { id: 8, code: "5000", name: "仕入", category: "COGS" };

const bizBank: MoneySource = { type: "bank", id: 10, name: "事業口座", businessUse: true };
const homeBank: MoneySource = { type: "bank", id: 11, name: "生活口座", businessUse: false };
const bizCredit: MoneySource = {
  type: "card",
  id: 20,
  name: "事業カード",
  cardType: "CREDIT_CARD",
  businessUse: true,
};
const bizPrepaid: MoneySource = {
  type: "card",
  id: 21,
  name: "事業の電子マネー",
  cardType: "E_MONEY",
  businessUse: true,
};

const entry = (over: Partial<AutoEntryInput>): AutoEntryInput => ({
  id: 100,
  date: "2030-03-10",
  description: "明細",
  account: tel,
  amount: 3000,
  flow: -3000,
  businessUse: true,
  businessRatio: 50,
  source: bizBank,
  pairId: null,
  ...over,
});
const book = (over: Partial<AutoBookInput>) =>
  buildAutoBook({
    startDate: "2030-01-01",
    entries: [],
    records: [],
    journals: [],
    openings: [],
    own: {},
    ...over,
  });
/** 仕訳の行を「科目名（補助） 借/貸 額」で並べる（借方 → 貸方） */
const linesOf = (b: AutoBook, i = 0) =>
  [...b.journals[i].lines]
    .sort((x, y) => x.side.localeCompare(y.side) * -1)
    .map((l) => {
      const a = b.accounts.get(l.key)!;
      return `${a.name}${a.sub ? `（${a.sub}）` : ""} ${l.side === "debit" ? "借" : "貸"} ${l.amount}`;
    });

describe("buildAutoBook: 明細", () => {
  it("事業用の口座から 50% の経費: 経費と事業主貸／普通預金", () => {
    const b = book({ entries: [entry({})] });
    expect(linesOf(b)).toEqual([
      "通信費 借 1500",
      "事業主貸 借 1500",
      "普通預金（事業口座） 貸 3000",
    ]);
  });

  it("按分なし（100%）は事業主貸を立てない", () => {
    const b = book({ entries: [entry({ businessRatio: 100 })] });
    expect(linesOf(b)).toEqual(["通信費 借 3000", "普通預金（事業口座） 貸 3000"]);
  });

  it("現金・クレジットカード・家計の口座の事業利用は、相手が事業主借", () => {
    for (const source of [{ type: "cash" } as MoneySource, bizCredit, homeBank]) {
      const b = book({ entries: [entry({ source })] });
      expect(linesOf(b)).toEqual(["通信費 借 1500", "事業主借 貸 1500"]);
    }
  });

  it("事業用の口座への売上の入金", () => {
    const b = book({
      entries: [entry({ account: sales, amount: 50000, flow: 50000, businessRatio: 100 })],
    });
    expect(linesOf(b)).toEqual(["普通預金（事業口座） 借 50000", "売上 貸 50000"]);
  });

  it("経費の返金（入金・負の実績）は経費の貸方", () => {
    const b = book({ entries: [entry({ amount: -1000, flow: 1000, businessRatio: 100 })] });
    expect(linesOf(b)).toEqual(["普通預金（事業口座） 借 1000", "通信費 貸 1000"]);
  });

  it("事業用の口座の、事業利用でない出金と入金は事業主貸・事業主借", () => {
    const b = book({
      entries: [
        entry({ id: 1, businessUse: false, businessRatio: null }),
        entry({ id: 2, businessUse: false, businessRatio: null, amount: 0, flow: 5000 }),
      ],
    });
    expect(linesOf(b, 0)).toEqual(["事業主貸 借 3000", "普通預金（事業口座） 貸 3000"]);
    expect(linesOf(b, 1)).toEqual(["普通預金（事業口座） 借 5000", "事業主借 貸 5000"]);
  });

  it("家計の口座の、事業利用でない明細は仕訳にしない", () => {
    const b = book({
      entries: [entry({ businessUse: false, businessRatio: null, source: homeBank })],
    });
    expect(b.journals).toEqual([]);
  });

  it("振替: 事業用どうしは口座の振替、片方だけなら事業主貸", () => {
    const leg = (id: number, source: MoneySource, flow: number, pairId: string) =>
      entry({
        id,
        source,
        flow,
        amount: 0,
        account: null,
        businessUse: false,
        businessRatio: null,
        pairId,
      });
    const b = book({
      entries: [
        leg(1, bizBank, -10000, "a"),
        leg(2, bizPrepaid, 10000, "a"),
        leg(3, bizBank, -20000, "b"),
        leg(4, homeBank, 20000, "b"),
      ],
    });
    expect(linesOf(b, 0)).toEqual([
      "預け金（事業の電子マネー） 借 10000",
      "普通預金（事業口座） 貸 10000",
    ]);
    expect(linesOf(b, 1)).toEqual(["事業主貸 借 20000", "普通預金（事業口座） 貸 20000"]);
  });
});

describe("buildAutoBook: 期首・実績の行・仕訳", () => {
  it("事業用の口座の期首残高は元入金", () => {
    const b = book({
      openings: [
        { source: bizBank, balance: 120000 },
        { source: homeBank, balance: 999 },
      ],
    });
    expect(b.journals).toHaveLength(1);
    expect(b.journals[0]).toMatchObject({ date: "2030-01-01", source: "opening" });
    expect(linesOf(b)).toEqual(["普通預金（事業口座） 借 120000", "元入金 貸 120000"]);
  });

  it("仕訳の無い実績の行は事業主借が相手。同じ科目・額の仕訳（減価償却）があればそれを使う", () => {
    const deprJournal = {
      id: 50,
      date: "2030-12-31",
      description: "PC 2030年度償却（自動仕訳）",
      linked: false,
      lines: [
        { account: depr, side: "debit" as const, amount: 80000 },
        { account: accum, side: "credit" as const, amount: 80000 },
      ],
    };
    const b = book({
      records: [
        { id: 1, date: "2030-12-31", account: depr, amount: 80000, journalEntryId: null },
        { id: 2, date: "2030-05-31", account: tel, amount: 10000, journalEntryId: null },
      ],
      journals: [deprJournal],
    });
    const byDesc = (d: string) => b.journals.findIndex((j) => j.description.startsWith(d));
    expect(linesOf(b, byDesc("PC"))).toEqual(["減価償却費 借 80000", "減価償却累計額 貸 80000"]);
    expect(linesOf(b, byDesc("通信費"))).toEqual(["通信費 借 10000", "事業主借 貸 10000"]);
    expect(b.journals).toHaveLength(2);
  });

  it("実績に入った仕訳はそのまま。損益の科目を含む実績に入らない仕訳は含めない", () => {
    const b = book({
      journals: [
        {
          id: 60,
          date: "2030-04-01",
          description: "売掛金発生",
          linked: true,
          lines: [
            { account: ar, side: "debit", amount: 30000 },
            { account: sales, side: "credit", amount: 30000 },
          ],
        },
        {
          id: 61,
          date: "2030-05-01",
          description: "売掛金の入金",
          linked: false,
          lines: [
            { account: deposit, side: "debit", amount: 30000 },
            { account: ar, side: "credit", amount: 30000 },
          ],
        },
        {
          id: 62,
          date: "2030-12-31",
          description: "棚卸確定",
          linked: false,
          lines: [
            { account: stock, side: "debit", amount: 5000 },
            { account: cogs, side: "credit", amount: 5000 },
          ],
        },
      ],
      records: [{ id: 9, date: "2030-04-30", account: sales, amount: 30000, journalEntryId: 60 }],
    });
    expect(b.journals.map((j) => j.refId)).toEqual([60, 61]);
    expect(b.skippedJournals).toEqual([{ id: 62, date: "2030-12-31", description: "棚卸確定" }]);
  });

  it("事業主貸・事業主借・普通預金が科目にあれば、その科目を使う", () => {
    const draw = { id: 90, code: "1950", name: "事業主貸", category: "ASSET" };
    const b = book({ entries: [entry({})], own: { draw, deposit } });
    const keys = b.journals[0].lines.map((l) => l.key).sort();
    expect(keys).toEqual(["acct:1", "acct:90", "bank:10"]);
    expect(b.accounts.get("bank:10")).toMatchObject({
      code: "1100",
      name: "普通預金",
      sub: "事業口座",
    });
  });

  it("仕訳は日付順に番号を振る（同じ日は期首 → 仕訳 → 実績の行 → 明細）", () => {
    const b = book({
      entries: [entry({ id: 1, date: "2030-01-01" }), entry({ id: 2, date: "2029-12-31" })],
      openings: [{ source: bizBank, balance: 100 }],
    });
    expect(b.journals.map((j) => [j.no, j.date, j.source])).toEqual([
      [1, "2029-12-31", "entry"],
      [2, "2030-01-01", "opening"],
      [3, "2030-01-01", "entry"],
    ]);
  });
});

describe("総勘定元帳・試算表", () => {
  const b = book({
    openings: [{ source: bizBank, balance: 100000 }],
    entries: [
      entry({ id: 1 }),
      entry({ id: 2, account: sales, amount: 50000, flow: 50000, businessRatio: 100 }),
      entry({ id: 3, source: { type: "cash" }, businessRatio: 100, amount: 2000, flow: -2000 }),
    ],
    records: [{ id: 4, date: "2030-05-31", account: tel, amount: 10000, journalEntryId: null }],
  });

  it("仕訳はどれも借方と貸方が一致する", () => {
    for (const j of b.journals) {
      const sum = (side: string) =>
        j.lines.filter((l) => l.side === side).reduce((s, l) => s + l.amount, 0);
      expect(sum("debit")).toBe(sum("credit"));
    }
  });

  it("試算表の借方と貸方の合計が一致し、所得は損益の科目から出る", () => {
    const tb = buildTrialBalance(b);
    expect(tb.totalDebit).toBe(tb.totalCredit);
    // 売上 50,000 − 通信費（1,500 + 2,000 + 10,000）
    expect(tb.income).toBe(36500);
  });

  it("元帳の残高は科目の自然な側で見る", () => {
    const ledgers = buildLedgers(b);
    const of = (name: string) => ledgers.find((l) => l.account.name === name)!;
    expect(of("普通預金").balance).toBe(100000 - 3000 + 50000);
    expect(of("元入金").balance).toBe(100000);
    expect(of("通信費").rows.map((r) => r.balance)).toEqual([1500, 3500, 13500]);
  });
});
