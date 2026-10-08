import type { FinancialRecord, Prisma, TxnSource } from "@prisma/client";
import type { TenantDb, TenantDbClient } from "@/lib/server/tenant-db";
import { classifyByRules } from "@/lib/ledger/banktxn-import";
import { resolveTransferTarget } from "@/lib/ledger/card-transfer";
import type { AccountCategoryValue } from "@/lib/accounting/account-category";
import { signedActualAmountFromSpend } from "@/lib/accounting/journal";
import { resolvePeriod } from "@/lib/accounting/period";
import { ACTUALS_LOCKED_MESSAGE, confirmedActualsPeriodIds } from "@/lib/budget/budget-lock";
import { conflict, notFound } from "@/lib/server/api-error";
import { applyAutoOffset } from "@/lib/ledger/auto-offset";

// 明細（実績の表 financial_records の kind を持つ行）の読み書きの共通部分。
//
// 現金・銀行口座・カード・電子マネーの明細は、実績と同じ表に 1 行ずつ載る。科目（accountId）が付いた行が実績で、
// amount はその科目の向きの実績の金額、flow は明細の入出金（種別によらず +入金 / −出金）。
// 科目が無い行（未割り当て・振替・チャージ）は amount = 0 で、実績には入らない。
// 以前のカード明細は +利用 / −返金だったため、カードの API の応答と、カードの符号で組んだ純関数
// （card-usage・charge-link・card-flow など）へ渡すときは cardSpend() で「+利用」に直す。
// API の応答の形（accountId・categoryAccountId・transferToAccountId など）は以前のまま返す。

/** 銀行明細の絞り込み（口座 id は bankAccountId） */
export const BANK = { kind: "BANK" } as const satisfies Prisma.FinancialRecordWhereInput;
/** カード明細の絞り込み（カード id は cardAccountId） */
export const CARD = { kind: "CARD" } as const satisfies Prisma.FinancialRecordWhereInput;
/** 現金の明細の絞り込み */
export const CASH = { kind: "CASH" } as const satisfies Prisma.FinancialRecordWhereInput;
/** 振替・チャージの組になっていない明細（実績の対象・科目を付けられる明細） */
export const UNPAIRED = {
  transferGroupId: null,
  chargeToCardId: null,
  chargeGroupId: null,
} as const satisfies Prisma.FinancialRecordWhereInput;

/** カード明細の金額を「+利用（支出） / −返金・入金」に直す（明細の flow は +入金 / −出金） */
export function cardSpend(flow: unknown): number {
  return -Number(flow);
}

/** 科目を付けた明細の実績の金額（科目の向き。費用は支出が正、収入は入金が正） */
export function entryActualAmount(category: string, flow: number): number {
  return signedActualAmountFromSpend(category as AccountCategoryValue, -flow);
}

type CategoryRef = { id: number; code: string; name: string };
type CardRef = { id: number; name: string };

type EntryWithRefs = FinancialRecord & {
  account?: CategoryRef | null;
  chargeToCard?: CardRef | null;
};

export type BankTxnDto = {
  id: number;
  accountId: number;
  date: Date;
  description: string;
  amount: number;
  balance: number | null;
  source: TxnSource | null;
  externalId: string | null;
  categoryAccountId: number | null;
  transferGroupId: string | null;
  chargeToAccountId: number | null;
  chargeGroupId: string | null;
  createdAt: Date;
  categoryAccount?: CategoryRef | null;
  chargeToAccount?: CardRef | null;
};

export type CardTxnDto = {
  id: number;
  accountId: number;
  date: Date;
  description: string;
  /** +利用（支出） / −返金 */
  amount: number;
  source: TxnSource | null;
  externalId: string | null;
  categoryAccountId: number | null;
  transferToAccountId: number | null;
  chargeGroupId: string | null;
  createdAt: Date;
  categoryAccount?: CategoryRef | null;
  transferToAccount?: CardRef | null;
};

/** 銀行明細を API の応答の形（以前の bank_transactions と同じ項目名）にする */
export function toBankTxn(e: EntryWithRefs): BankTxnDto {
  return {
    id: e.id,
    accountId: e.bankAccountId!,
    date: e.date!,
    description: e.description!,
    amount: Number(e.flow),
    balance: e.balance ? Number(e.balance) : null,
    source: e.source,
    externalId: e.externalId,
    categoryAccountId: e.accountId,
    transferGroupId: e.transferGroupId,
    chargeToAccountId: e.chargeToCardId,
    chargeGroupId: e.chargeGroupId,
    createdAt: e.createdAt,
    ...(e.account !== undefined ? { categoryAccount: e.account } : {}),
    ...(e.chargeToCard !== undefined ? { chargeToAccount: e.chargeToCard } : {}),
  };
}

/** カード明細を API の応答の形（以前の card_transactions と同じ項目名・符号）にする */
export function toCardTxn(e: EntryWithRefs): CardTxnDto {
  return {
    id: e.id,
    accountId: e.cardAccountId!,
    date: e.date!,
    description: e.description!,
    amount: cardSpend(e.flow),
    source: e.source,
    externalId: e.externalId,
    categoryAccountId: e.accountId,
    transferToAccountId: e.chargeToCardId,
    chargeGroupId: e.chargeGroupId,
    createdAt: e.createdAt,
    ...(e.account !== undefined ? { categoryAccount: e.account } : {}),
    ...(e.chargeToCard !== undefined ? { transferToAccount: e.chargeToCard } : {}),
  };
}

export type CashEntryDto = {
  id: number;
  date: Date;
  description: string;
  /** +入金 / −出金 */
  amount: number;
  categoryAccountId: number | null;
  categoryAccount: (CategoryRef & { category: string }) | null;
  createdAt: Date;
};

/** 現金の明細を API の応答の形にする */
export function toCashEntry(
  e: FinancialRecord & { account: (CategoryRef & { category: string }) | null },
): CashEntryDto {
  return {
    id: e.id,
    date: e.date!,
    description: e.description!,
    amount: Number(e.flow),
    categoryAccountId: e.accountId,
    categoryAccount: e.account,
    createdAt: e.createdAt,
  };
}

/** 一覧で添える科目とチャージ先 */
export const ENTRY_REFS_INCLUDE = {
  account: { select: { id: true, code: true, name: true } },
  chargeToCard: { select: { id: true, name: true } },
} as const satisfies Prisma.FinancialRecordInclude;

/** 明細の置き場所（種別と口座） */
export type EntryTarget =
  | { kind: "CASH" }
  | { kind: "BANK"; accountId: number }
  | { kind: "CARD"; accountId: number };

const targetColumns = (t: EntryTarget) =>
  t.kind === "BANK"
    ? { kind: t.kind, bankAccountId: t.accountId }
    : t.kind === "CARD"
      ? { kind: t.kind, cardAccountId: t.accountId }
      : { kind: t.kind };

/** 日付の年月（サーバーの年月。resolvePeriodForDate と同じ） */
const ymKey = (d: Date) => `${d.getFullYear()}-${d.getMonth() + 1}`;

/**
 * 日付の一覧に対応する期間を用意し、年月 → 期間 id と、実績を確定済みの年月を返す。
 * 明細の行は必ず取引日の年月の期間を持つ。
 */
export async function resolveEntryPeriods(db: TenantDbClient, tenantId: number, dates: Date[]) {
  const keys = new Map<string, Date>();
  for (const d of dates) keys.set(ymKey(d), d);
  const periodIds = new Map<string, number>();
  for (const [key, d] of keys) {
    const period = await resolvePeriod(db, tenantId, d.getFullYear(), d.getMonth() + 1);
    periodIds.set(key, period.id);
  }
  const confirmed = await confirmedActualsPeriodIds(db, [...periodIds.values()]);
  return {
    periodIdOf: (d: Date) => periodIds.get(ymKey(d))!,
    isLocked: (d: Date) => confirmed.has(periodIds.get(ymKey(d))!),
  };
}

export type NewEntry = {
  date: Date;
  description: string;
  /** +入金 / −出金 */
  flow: number;
  balance?: number | null;
  source: TxnSource;
  externalId?: string | null;
  transferGroupId?: string | null;
  chargeToCardId?: number | null;
  /** 科目（区分つき）。無ければ未割り当て */
  category?: { id: number; category: string } | null;
};

/** 明細 1 行の登録データ（期間と実績の金額をそろえる） */
export function entryCreateData(
  tenantId: number,
  target: EntryTarget,
  periodId: number,
  e: NewEntry,
): Prisma.FinancialRecordUncheckedCreateInput {
  const paired = !!(e.transferGroupId || e.chargeToCardId);
  const category = paired ? null : (e.category ?? null);
  return {
    tenantId,
    ...targetColumns(target),
    periodId,
    date: e.date,
    description: e.description,
    flow: e.flow,
    balance: e.balance ?? null,
    source: e.source,
    externalId: e.externalId ?? null,
    transferGroupId: e.transferGroupId ?? null,
    chargeToCardId: e.chargeToCardId ?? null,
    accountId: category?.id ?? null,
    amount: category ? entryActualAmount(category.category, e.flow) : 0,
  };
}

export type ExternalEntryRow = {
  externalId: string;
  date: string | Date;
  description: string;
  /** +入金 / −出金（銀行・カードとも CSV の生の明細の符号） */
  amount: number;
  balance?: number | null;
};

export type InsertResult = {
  /** 新しく登録した件数 */
  inserted: number;
  /** 実績を確定済みの月のため飛ばした件数 */
  locked: number;
  /** 自動相殺で振替・チャージの組にした数（lib/ledger/auto-offset.ts） */
  offset: number;
};

/**
 * 学習ルール（txn_category_rules）で摘要から科目を決める関数を用意する。
 * 当たらなければ null（未割り当て）。
 */
export async function loadRuleClassifier(db: TenantDbClient) {
  const rules = await db.txnCategoryRule.findMany({
    select: {
      keyword: true,
      categoryAccountId: true,
      priority: true,
      categoryAccount: { select: { category: true } },
    },
  });
  const categoryOf = new Map(rules.map((r) => [r.categoryAccountId, r.categoryAccount.category]));
  return (description: string): { id: number; category: string } | null => {
    const id = classifyByRules(description, rules);
    return id === null ? null : { id, category: categoryOf.get(id)! };
  };
}

// 外部由来（CSV 取込・自動同期）の明細を登録する。
// 銀行・カードは、口座ごとの externalId の一意制約で重複行を自動的にスキップする（createMany + skipDuplicates）。
// 現金は口座が無く一意制約が効かないので、同じ externalId の現金の明細があれば先に除く。
// 摘要が学習ルールに当たった明細には科目を付け、その行はそのまま実績になる。
// カードは、取り込む先のカードのチャージのルール（card_transfer_rules）に当たった行をチャージにし、科目を付けない。
// 実績を確定済みの月の行は、実績を変えないよう登録しない（locked に数える）。
// 登録したあと、その日付の明細に自動相殺（lib/ledger/auto-offset.ts）をかける。
export async function insertExternalEntries(
  db: TenantDb,
  tenantId: number,
  target: EntryTarget,
  rows: ExternalEntryRow[],
  source: Extract<TxnSource, "CSV" | "SYNC">,
): Promise<InsertResult> {
  if (rows.length === 0) return { inserted: 0, locked: 0, offset: 0 };

  const [classify, transferRules] = await Promise.all([
    loadRuleClassifier(db),
    // チャージ判定は取り込む先のカードに紐付いたルールだけを見る
    // （同じ摘要が別のカードでは通常の利用を指すことがあるため）
    target.kind === "CARD"
      ? db.cardTransferRule.findMany({
          where: { accountId: target.accountId },
          select: { keyword: true, transferToAccountId: true },
        })
      : Promise.resolve([]),
  ]);

  const dated = rows.map((r) => ({ ...r, date: new Date(r.date) }));
  const periods = await resolveEntryPeriods(
    db,
    tenantId,
    dated.map((r) => r.date),
  );
  let open = dated.filter((r) => !periods.isLocked(r.date));
  if (target.kind === "CASH" && open.length > 0) {
    const existing = await db.financialRecord.findMany({
      where: { ...CASH, externalId: { in: open.map((r) => r.externalId) } },
      select: { externalId: true },
    });
    const seen = new Set(existing.map((e) => e.externalId));
    open = open.filter((r) => !seen.has(r.externalId) && (seen.add(r.externalId), true));
  }

  const { count } = await db.financialRecord.createMany({
    data: open.map((r) => {
      const chargeToCardId =
        target.kind === "CARD" ? resolveTransferTarget(r.description, transferRules) : null;
      return entryCreateData(tenantId, target, periods.periodIdOf(r.date), {
        date: r.date,
        description: r.description,
        flow: r.amount,
        balance: target.kind === "BANK" ? (r.balance ?? null) : null,
        source,
        externalId: r.externalId,
        chargeToCardId,
        // チャージ（資金移動）と判定した行は支出ではないので科目を付けない
        category: chargeToCardId === null ? classify(r.description) : null,
      });
    }),
    skipDuplicates: true,
  });
  const { pairs } =
    target.kind === "CASH" || count === 0
      ? { pairs: 0 }
      : await applyAutoOffset(
          db,
          open.map((r) => r.date),
        );
  const locked = dated.filter((r) => periods.isLocked(r.date)).length;
  return { inserted: count, locked, offset: pairs };
}

/**
 * 画面から登録する明細の科目。指定が無ければ学習ルールで決め、null なら未割り当て。
 * 指定した科目が自テナントに無ければ 404。
 */
export async function entryCategory(
  db: TenantDbClient,
  tenantId: number,
  categoryAccountId: number | null | undefined,
  description: string,
): Promise<{ id: number; category: string } | null> {
  if (categoryAccountId === null) return null;
  if (categoryAccountId === undefined) return (await loadRuleClassifier(db))(description);
  const account = await db.account.findUnique({
    where: { id: categoryAccountId, tenantId },
    select: { id: true, category: true },
  });
  if (!account) throw notFound("科目が見つかりません");
  return account;
}

/**
 * 明細を 1 行登録する（画面からの登録・振替の作成など）。
 * 取引日の年月の期間を用意し、実績を確定済みの月なら 409 を返す（確定した実績を変えないため）。
 */
export async function createEntry(
  db: TenantDbClient,
  tenantId: number,
  target: EntryTarget,
  entry: NewEntry,
) {
  const periods = await resolveEntryPeriods(db, tenantId, [entry.date]);
  if (periods.isLocked(entry.date)) throw conflict(ACTUALS_LOCKED_MESSAGE);
  return db.financialRecord.create({
    data: entryCreateData(tenantId, target, periods.periodIdOf(entry.date), entry),
  });
}
