// 実績から作る仕訳（個人事業主モードの仕訳帳・総勘定元帳・試算表）。
//
// 個人事業主モードでは仕訳を手で入れず、実績（明細と、明細でない実績の行）から複式の仕訳を作って見せる。
// 保存はせず、表示のたびに作る（実績を直せば帳簿もそのまま変わる）。データの読み込みは auto-journal-data.ts。
//
// 仕訳の作り方（借方と貸方の差は、事業主貸・事業主借で埋める）:
//   - 事業利用の明細: 科目に事業の分（按分した額）を立てる。出どころが事業用の口座・電子マネー等なら、
//     明細の全額をその口座に立て、家計の分は事業主貸（出金）・事業主借（入金）になる。
//     出どころが現金・クレジットカード・事業用でない口座なら、事業主が立て替えた（受け取った）ものとして
//     相手は事業主借（事業主貸）。
//     例: 事業用の口座から通信費 3,000 円を 50% で払った → 借方 通信費 1,500・事業主貸 1,500／貸方 普通預金 3,000
//   - 事業用の口座・電子マネー等の、事業利用でない明細: 口座と事業主貸（出金）・事業主借（入金）。
//   - 振替・チャージの組: 両方が事業用なら口座どうしの振替。片方だけなら事業主貸・事業主借。
//   - 明細でない実績の行: 仕訳から入った行はその仕訳をそのまま使う。仕訳の無い行（直接入力）は、
//     相手を事業主借・事業主貸にする。減価償却のように、同じ科目・同じ額の仕訳が別にあるときはその仕訳を使う。
//   - 実績に入らない仕訳のうち、損益の科目を含まないもの（売掛金・買掛金の消込など）はそのまま含める。
//     損益の科目を含むもの（棚卸の確定など）は決算書と合わなくなるので含めず、件数を返す。
//   - 期首: 事業用の口座・電子マネー等の、年度の初めの残高を元入金として立てる。
//
// 損益の科目は、決算書（/api/closing/statements の scope=business）と同じ実績の行・同じ事業の分の額から作るので、
// 試算表の損益は決算書の所得と一致する。

import { businessPortion } from "@/lib/shared/business-use";

/** 帳簿の科目の区分。CAPITAL は事業主借・元入金（資本の側） */
export type BookCategory =
  | "ASSET"
  | "LIABILITY"
  | "CAPITAL"
  | "REVENUE"
  | "COGS"
  | "EXPENSE"
  | "PROFIT"
  | "OTHER";

export type BookAccount = {
  /** 帳簿の中での科目の識別子（acct:<科目 id> / bank:<口座 id> / card:<カード id> / owner:<種類>） */
  key: string;
  code: string;
  name: string;
  category: BookCategory;
  /** 補助科目（普通預金・預け金の口座やカードの名前） */
  sub: string | null;
};

export type BookLine = { key: string; side: "debit" | "credit"; amount: number };

export type AutoJournal = {
  /** 年度の中の通し番号（日付順） */
  no: number;
  /** YYYY-MM-DD */
  date: string;
  description: string;
  /** 作った元: 明細・振替やチャージの組・明細でない実績の行・既存の仕訳・期首 */
  source: "entry" | "pair" | "record" | "journal" | "opening";
  /** 元の行の id（明細・実績の行・仕訳。期首は null） */
  refId: number | null;
  lines: BookLine[];
};

type AccountRef = { id: number; code: string; name: string; category: string };

export type MoneySource =
  | { type: "cash" }
  | { type: "bank"; id: number; name: string; businessUse: boolean }
  | { type: "card"; id: number; name: string; cardType: string; businessUse: boolean };

export type AutoEntryInput = {
  id: number;
  date: string;
  description: string;
  account: AccountRef | null;
  /** 実績の額（financial_records.amount。科目の自然な増加側が正） */
  amount: number;
  /** +入金 / −出金 */
  flow: number;
  businessUse: boolean;
  businessRatio: number | null;
  source: MoneySource;
  /** 振替・チャージの組の識別子（transferGroupId または chargeGroupId） */
  pairId: string | null;
};

export type AutoRecordInput = {
  id: number;
  /** その月の末日（明細でない行は日付を持たない） */
  date: string;
  account: AccountRef;
  amount: number;
  journalEntryId: number | null;
};

export type AutoJournalInput = {
  id: number;
  date: string;
  description: string;
  /** 実績の行が結び付いている（仕訳から実績に入った）か */
  linked: boolean;
  lines: { account: AccountRef; side: "debit" | "credit"; amount: number }[];
};

export type AutoOpeningInput = { source: MoneySource; balance: number };

/** 事業主貸・事業主借・元入金・普通預金・預け金が科目にあれば使う（同じ名前・区分の科目が 1 つだけのとき） */
export type OwnAccounts = Partial<
  Record<"draw" | "contribution" | "capital" | "deposit" | "prepaid", AccountRef>
>;

export type AutoBookInput = {
  /** 年度の初日（YYYY-MM-DD）。期首の仕訳の日付 */
  startDate: string;
  entries: AutoEntryInput[];
  records: AutoRecordInput[];
  journals: AutoJournalInput[];
  openings: AutoOpeningInput[];
  own: OwnAccounts;
};

export type AutoBook = {
  journals: AutoJournal[];
  accounts: Map<string, BookAccount>;
  /** 含めなかった仕訳（損益の科目を含むが実績に入っていないもの） */
  skippedJournals: { id: number; date: string; description: string }[];
};

const PL_CATEGORIES = new Set(["REVENUE", "COGS", "EXPENSE", "PROFIT"]);
const DEBIT_NATURAL = new Set<string>(["ASSET", "EXPENSE", "COGS"]);

/** 科目の区分の自然な増加側 */
export function naturalSide(category: string): "debit" | "credit" {
  return DEBIT_NATURAL.has(category) ? "debit" : "credit";
}

const opposite = (side: "debit" | "credit") => (side === "debit" ? "credit" : "debit");

/** 事業用の口座・電子マネー等か（帳簿に残高を持つ出どころ）。クレジットカードは事業主借で受けるので持たない */
export function isBookSource(source: MoneySource): boolean {
  if (source.type === "cash") return false;
  if (source.type === "bank") return source.businessUse;
  return source.businessUse && source.cardType !== "CREDIT_CARD";
}

export function buildAutoBook(input: AutoBookInput): AutoBook {
  const accounts = new Map<string, BookAccount>();
  const realKey = (a: AccountRef) => {
    const key = `acct:${a.id}`;
    if (!accounts.has(key)) {
      accounts.set(key, {
        key,
        code: a.code,
        name: a.name,
        category: toBookCategory(a.category),
        sub: null,
      });
    }
    return key;
  };
  const ownKey = (kind: "draw" | "contribution" | "capital") => {
    const real = input.own[kind];
    if (real) return realKey(real);
    const key = `owner:${kind}`;
    if (!accounts.has(key)) accounts.set(key, OWNER_ACCOUNTS[kind]);
    return key;
  };
  const sourceKey = (source: MoneySource) => {
    if (source.type === "cash") throw new Error("現金は帳簿に残高を持たない");
    const key = `${source.type}:${source.id}`;
    if (!accounts.has(key)) {
      const real = source.type === "bank" ? input.own.deposit : input.own.prepaid;
      accounts.set(key, {
        key,
        code: real?.code ?? (source.type === "bank" ? "1100" : "1160"),
        name: real?.name ?? (source.type === "bank" ? "普通預金" : "預け金"),
        category: "ASSET",
        sub: source.name,
      });
    }
    return key;
  };

  /** 符号付きの額を、正なら自然な側・負なら反対側の行にする */
  const signedLine = (account: AccountRef, signed: number): BookLine | null => {
    if (signed === 0) return null;
    const side = naturalSide(account.category);
    return signed > 0
      ? { key: realKey(account), side, amount: signed }
      : { key: realKey(account), side: opposite(side), amount: -signed };
  };
  const moneyLine = (source: MoneySource, flow: number): BookLine | null =>
    flow === 0
      ? null
      : { key: sourceKey(source), side: flow > 0 ? "debit" : "credit", amount: Math.abs(flow) };

  /** 借方と貸方の差を埋める行を足す（借方が足りなければ drawKey、貸方が足りなければ creditKey） */
  const balanced = (lines: BookLine[], drawKey: () => string, creditKey: () => string) => {
    const diff = lines.reduce((s, l) => s + (l.side === "debit" ? l.amount : -l.amount), 0);
    const rounded = Math.round(diff * 100) / 100;
    if (rounded < 0) lines.push({ key: drawKey(), side: "debit", amount: -rounded });
    if (rounded > 0) lines.push({ key: creditKey(), side: "credit", amount: rounded });
    return lines;
  };
  const withOwner = (lines: BookLine[]) =>
    balanced(
      lines,
      () => ownKey("draw"),
      () => ownKey("contribution"),
    );

  const out: Omit<AutoJournal, "no">[] = [];

  // 期首: 事業用の口座・電子マネー等の残高を元入金に
  for (const o of input.openings) {
    if (!isBookSource(o.source) || o.balance === 0) continue;
    const line = moneyLine(o.source, o.balance)!;
    const capital = ownKey("capital");
    out.push({
      date: input.startDate,
      description: `期首残高（${o.source.type === "cash" ? "現金" : o.source.name}）`,
      source: "opening",
      refId: null,
      lines: balanced(
        [line],
        () => capital,
        () => capital,
      ),
    });
  }

  // 明細（振替・チャージの組は組ごとに 1 本）
  const pairs = new Map<string, AutoEntryInput[]>();
  for (const e of input.entries) {
    if (e.pairId) {
      pairs.set(e.pairId, [...(pairs.get(e.pairId) ?? []), e]);
      continue;
    }
    const lines: BookLine[] = [];
    if (e.businessUse && e.businessRatio !== null && e.account) {
      const l = signedLine(e.account, businessPortion(e.amount, e.businessRatio));
      if (l) lines.push(l);
    }
    if (isBookSource(e.source)) {
      const l = moneyLine(e.source, e.flow);
      if (l) lines.push(l);
    }
    if (lines.length === 0) continue;
    out.push({
      date: e.date,
      description: e.description,
      source: "entry",
      refId: e.id,
      lines: withOwner(lines),
    });
  }
  for (const legs of pairs.values()) {
    const lines = legs
      .filter((e) => isBookSource(e.source))
      .map((e) => moneyLine(e.source, e.flow))
      .filter((l): l is BookLine => l !== null);
    if (lines.length === 0) continue;
    const first = [...legs].sort((a, b) => a.flow - b.flow || a.id - b.id)[0];
    out.push({
      date: first.date,
      description: first.description,
      source: "pair",
      refId: first.id,
      lines: withOwner(lines),
    });
  }

  // 明細でない実績の行と、既存の仕訳
  const journalLines = (j: AutoJournalInput): BookLine[] =>
    j.lines.map((l) => ({ key: realKey(l.account), side: l.side, amount: l.amount }));
  const usedJournals = new Set<number>();
  const unlinked = input.journals.filter((j) => !j.linked);
  for (const j of input.journals.filter((j) => j.linked)) {
    usedJournals.add(j.id);
    out.push({
      date: j.date,
      description: j.description,
      source: "journal",
      refId: j.id,
      lines: journalLines(j),
    });
  }
  for (const r of input.records) {
    if (r.journalEntryId !== null || !PL_CATEGORIES.has(r.account.category)) continue;
    // 同じ科目・同じ額の損益の行を持つ、まだ使っていない仕訳（減価償却など）があればそれを使う
    const match = unlinked.find(
      (j) =>
        !usedJournals.has(j.id) &&
        j.lines.some(
          (l) =>
            l.account.id === r.account.id &&
            (l.side === naturalSide(l.account.category) ? l.amount : -l.amount) === r.amount,
        ),
    );
    if (match) {
      usedJournals.add(match.id);
      out.push({
        date: match.date,
        description: match.description,
        source: "journal",
        refId: match.id,
        lines: journalLines(match),
      });
      continue;
    }
    const line = signedLine(r.account, r.amount);
    if (!line) continue;
    out.push({
      date: r.date,
      description: `${r.account.name}（実績の直接入力）`,
      source: "record",
      refId: r.id,
      lines: withOwner([line]),
    });
  }
  const skippedJournals: AutoBook["skippedJournals"] = [];
  for (const j of unlinked) {
    if (usedJournals.has(j.id)) continue;
    if (j.lines.some((l) => PL_CATEGORIES.has(l.account.category))) {
      skippedJournals.push({ id: j.id, date: j.date, description: j.description });
      continue;
    }
    out.push({
      date: j.date,
      description: j.description,
      source: "journal",
      refId: j.id,
      lines: journalLines(j),
    });
  }

  const SOURCE_ORDER = { opening: 0, journal: 1, record: 2, entry: 3, pair: 4 } as const;
  out.sort(
    (a, b) =>
      a.date.localeCompare(b.date) ||
      SOURCE_ORDER[a.source] - SOURCE_ORDER[b.source] ||
      (a.refId ?? 0) - (b.refId ?? 0),
  );
  return {
    journals: out.map((j, i) => ({ ...j, no: i + 1 })),
    accounts,
    skippedJournals,
  };
}

const OWNER_ACCOUNTS: Record<"draw" | "contribution" | "capital", BookAccount> = {
  draw: { key: "owner:draw", code: "1900", name: "事業主貸", category: "ASSET", sub: null },
  contribution: {
    key: "owner:contribution",
    code: "3900",
    name: "事業主借",
    category: "CAPITAL",
    sub: null,
  },
  capital: { key: "owner:capital", code: "3950", name: "元入金", category: "CAPITAL", sub: null },
};

function toBookCategory(category: string): BookCategory {
  switch (category) {
    case "ASSET":
    case "LIABILITY":
    case "REVENUE":
    case "COGS":
    case "EXPENSE":
    case "PROFIT":
      return category;
    default:
      return "OTHER";
  }
}

// ── 総勘定元帳・試算表 ───────────────────────────────────────────

/** 帳簿の科目の並び（コード順、同じコードは補助科目の名前順） */
export function compareBookAccounts(a: BookAccount, b: BookAccount): number {
  return a.code.localeCompare(b.code) || (a.sub ?? "").localeCompare(b.sub ?? "");
}

export type BookLedger = {
  account: BookAccount;
  rows: {
    date: string;
    no: number;
    description: string;
    debit: number;
    credit: number;
    /** 科目の自然な側で見た残高（資産・費用は借方 − 貸方、それ以外は貸方 − 借方） */
    balance: number;
  }[];
  totalDebit: number;
  totalCredit: number;
  balance: number;
};

export function buildLedgers(book: AutoBook): BookLedger[] {
  const byKey = new Map<string, BookLedger>();
  for (const j of book.journals) {
    for (const l of j.lines) {
      const account = book.accounts.get(l.key)!;
      let ledger = byKey.get(l.key);
      if (!ledger) {
        ledger = { account, rows: [], totalDebit: 0, totalCredit: 0, balance: 0 };
        byKey.set(l.key, ledger);
      }
      const debit = l.side === "debit" ? l.amount : 0;
      const credit = l.side === "credit" ? l.amount : 0;
      ledger.totalDebit += debit;
      ledger.totalCredit += credit;
      ledger.balance += naturalSide(account.category) === "debit" ? debit - credit : credit - debit;
      ledger.rows.push({
        date: j.date,
        no: j.no,
        description: j.description,
        debit,
        credit,
        balance: ledger.balance,
      });
    }
  }
  return [...byKey.values()].sort((a, b) => compareBookAccounts(a.account, b.account));
}

export type TrialBalance = {
  rows: { account: BookAccount; debit: number; credit: number; balance: number }[];
  totalDebit: number;
  totalCredit: number;
  /** 損益の科目から求めた所得（収入 − 原価 − 経費）。決算書の所得と一致する */
  income: number;
};

export function buildTrialBalance(book: AutoBook): TrialBalance {
  const ledgers = buildLedgers(book);
  const rows = ledgers.map((l) => ({
    account: l.account,
    debit: l.totalDebit,
    credit: l.totalCredit,
    balance: l.balance,
  }));
  const sumOf = (category: BookCategory) =>
    rows.filter((r) => r.account.category === category).reduce((s, r) => s + r.balance, 0);
  return {
    rows,
    totalDebit: rows.reduce((s, r) => s + r.debit, 0),
    totalCredit: rows.reduce((s, r) => s + r.credit, 0),
    income: sumOf("REVENUE") - sumOf("COGS") - sumOf("EXPENSE"),
  };
}
