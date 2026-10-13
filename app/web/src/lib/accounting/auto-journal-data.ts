// 実績から作る仕訳（auto-journal.ts）の材料を DB から読む。
//
// 年度は暦年（個人事業主の会計期間。実績の行の期間 fiscalYear と同じ）。決算書（scope=business）と同じ行を読むため、
// 実績の行は期間の年で選ぶ。事業用の口座・電子マネー等は、事業利用でない明細と振替・チャージの組も読む。
import type { TenantDbClient } from "@/lib/server/tenant-db";
import { toYmd, monthEndYmd } from "@/lib/ledger/actuals-coverage";
import {
  buildAutoBook,
  type AutoBook,
  type AutoEntryInput,
  type MoneySource,
  type OwnAccounts,
} from "@/lib/accounting/auto-journal";

const ACCOUNT_SELECT = { id: true, code: true, name: true, category: true } as const;

export async function loadAutoBook(
  db: TenantDbClient,
  tenantId: number,
  year: number,
): Promise<AutoBook> {
  const [banks, cards] = await Promise.all([
    db.bankAccount.findMany({
      where: { tenantId },
      select: { id: true, name: true, businessUse: true, balanceAdjustment: true },
    }),
    db.linkedAccount.findMany({
      where: { tenantId },
      select: { id: true, name: true, type: true, businessUse: true },
    }),
  ]);
  const bankById = new Map(banks.map((b) => [b.id, b]));
  const cardById = new Map(cards.map((c) => [c.id, c]));
  const sourceOf = (r: {
    kind: string | null;
    bankAccountId: number | null;
    cardAccountId: number | null;
  }): MoneySource => {
    const bank =
      r.kind === "BANK" && r.bankAccountId !== null ? bankById.get(r.bankAccountId) : null;
    if (bank) return { type: "bank", id: bank.id, name: bank.name, businessUse: bank.businessUse };
    const card =
      r.kind === "CARD" && r.cardAccountId !== null ? cardById.get(r.cardAccountId) : null;
    if (card) {
      return {
        type: "card",
        id: card.id,
        name: card.name,
        cardType: card.type,
        businessUse: card.businessUse,
      };
    }
    return { type: "cash" };
  };
  const businessBankIds = banks.filter((b) => b.businessUse).map((b) => b.id);
  const businessCardIds = cards
    .filter((c) => c.businessUse && c.type !== "CREDIT_CARD")
    .map((c) => c.id);
  const onBookSource = [
    ...(businessBankIds.length
      ? [{ kind: "BANK" as const, bankAccountId: { in: businessBankIds } }]
      : []),
    ...(businessCardIds.length
      ? [{ kind: "CARD" as const, cardAccountId: { in: businessCardIds } }]
      : []),
  ];

  const inYear = { period: { fiscalYear: year } };
  const [entryRows, recordRows, journalRows, openingBank, openingCard, ownCandidates] =
    await Promise.all([
      // 明細: 事業利用のもの、または事業用の口座・電子マネー等のもの
      db.financialRecord.findMany({
        where: {
          tenantId,
          ...inYear,
          kind: { not: null },
          OR: [{ businessUse: true }, ...onBookSource],
        },
        select: {
          id: true,
          date: true,
          description: true,
          amount: true,
          flow: true,
          kind: true,
          bankAccountId: true,
          cardAccountId: true,
          businessUse: true,
          businessRatio: true,
          transferGroupId: true,
          chargeGroupId: true,
          account: { select: ACCOUNT_SELECT },
        },
        orderBy: { id: "asc" },
      }),
      // 明細でない実績の行
      db.financialRecord.findMany({
        where: { tenantId, ...inYear, kind: null, accountId: { not: null } },
        select: {
          id: true,
          amount: true,
          journalEntryId: true,
          period: { select: { fiscalYear: true, month: true } },
          account: { select: ACCOUNT_SELECT },
        },
        orderBy: { id: "asc" },
      }),
      // 仕訳: その年の実績の行が結び付いているもの、または実績の行を持たずその年の日付のもの
      db.journalEntry.findMany({
        where: {
          tenantId,
          OR: [
            { financialRecords: { some: { ...inYear } } },
            {
              financialRecords: { none: {} },
              transactionDate: { gte: new Date(year, 0, 1), lt: new Date(year + 1, 0, 1) },
            },
          ],
        },
        select: {
          id: true,
          transactionDate: true,
          description: true,
          _count: { select: { financialRecords: true } },
          details: {
            select: { side: true, amount: true, account: { select: ACCOUNT_SELECT } },
            orderBy: [{ side: "asc" }, { id: "asc" }],
          },
        },
      }),
      businessBankIds.length
        ? db.financialRecord.groupBy({
            by: ["bankAccountId"],
            where: {
              tenantId,
              kind: "BANK",
              bankAccountId: { in: businessBankIds },
              period: { fiscalYear: { lt: year } },
            },
            _sum: { flow: true },
          })
        : [],
      businessCardIds.length
        ? db.financialRecord.groupBy({
            by: ["cardAccountId"],
            where: {
              tenantId,
              kind: "CARD",
              cardAccountId: { in: businessCardIds },
              period: { fiscalYear: { lt: year } },
            },
            _sum: { flow: true },
          })
        : [],
      db.account.findMany({
        where: {
          tenantId,
          name: { in: ["事業主貸", "事業主借", "元入金", "普通預金", "預け金"] },
        },
        select: ACCOUNT_SELECT,
      }),
    ]);

  const entries: AutoEntryInput[] = entryRows.map((r) => ({
    id: r.id,
    date: r.date ? toYmd(r.date) : `${year}-01-01`,
    description: r.description ?? "",
    account: r.account,
    amount: Number(r.amount),
    flow: Number(r.flow ?? 0),
    businessUse: r.businessUse,
    businessRatio: r.businessRatio === null ? null : Number(r.businessRatio),
    source: sourceOf(r),
    pairId: r.transferGroupId ?? r.chargeGroupId,
  }));

  const openingByBank = new Map(
    openingBank.map((g) => [g.bankAccountId, Number(g._sum.flow ?? 0)]),
  );
  const openingByCard = new Map(
    openingCard.map((g) => [g.cardAccountId, Number(g._sum.flow ?? 0)]),
  );
  const openings = [
    ...businessBankIds.map((id) => {
      const b = bankById.get(id)!;
      return {
        source: { type: "bank", id, name: b.name, businessUse: true } as MoneySource,
        balance: (openingByBank.get(id) ?? 0) + Number(b.balanceAdjustment ?? 0),
      };
    }),
    ...businessCardIds.map((id) => {
      const c = cardById.get(id)!;
      return {
        source: {
          type: "card",
          id,
          name: c.name,
          cardType: c.type,
          businessUse: true,
        } as MoneySource,
        balance: openingByCard.get(id) ?? 0,
      };
    }),
  ];

  // 同じ名前の科目が 1 つだけなら、その科目を使う（区分も合うときだけ）
  const own: OwnAccounts = {};
  const pick = (name: string, categories: string[]) => {
    const hits = ownCandidates.filter((a) => a.name === name && categories.includes(a.category));
    return hits.length === 1 ? hits[0] : undefined;
  };
  own.draw = pick("事業主貸", ["ASSET"]);
  own.contribution = pick("事業主借", ["LIABILITY", "OTHER"]);
  own.capital = pick("元入金", ["LIABILITY", "OTHER"]);
  own.deposit = pick("普通預金", ["ASSET"]);
  own.prepaid = pick("預け金", ["ASSET"]);

  return buildAutoBook({
    startDate: `${year}-01-01`,
    entries,
    records: recordRows.map((r) => ({
      id: r.id,
      date: monthEndYmd(r.period.fiscalYear, r.period.month),
      account: r.account!,
      amount: Number(r.amount),
      journalEntryId: r.journalEntryId,
    })),
    journals: journalRows.map((j) => ({
      id: j.id,
      date: toYmd(j.transactionDate),
      description: j.description,
      linked: j._count.financialRecords > 0,
      lines: j.details.map((d) => ({
        account: d.account,
        side: d.side === "credit" ? "credit" : "debit",
        amount: Number(d.amount),
      })),
    })),
    openings,
    own,
  });
}
