import type { LedgerEntry, Prisma, TxnSource } from "@prisma/client";
import type { TenantDb } from "@/lib/tenant-db";
import { classifyByRules } from "@/lib/banktxn-import";
import { resolveTransferTarget } from "@/lib/card-transfer";

// 明細の表（ledger_entries）の読み書きの共通部分。
//
// 現金・銀行口座・カード・電子マネーの明細を 1 つの表に持ち、kind で台帳の種別を分ける。
// 金額は種別によらず +入金 / −出金。以前のカード明細（card_transactions）は +利用 / −返金だったため、
// カードの API の応答と、カードの符号で組んだ純関数（card-usage・charge-link・card-flow など）へ渡すときは
// cardSpend() で「+利用」に直す。API の応答の形（accountId・transferToAccountId など）も以前のまま返す。

/** 銀行明細の絞り込み（口座 id は bankAccountId） */
export const BANK = { kind: "BANK" } as const satisfies Prisma.LedgerEntryWhereInput;
/** カード明細の絞り込み（カード id は cardAccountId） */
export const CARD = { kind: "CARD" } as const satisfies Prisma.LedgerEntryWhereInput;

/** カード明細の金額を「+利用（支出） / −返金・入金」に直す（ledger_entries は +入金 / −出金） */
export function cardSpend(amount: unknown): number {
  return -Number(amount);
}

type CategoryRef = { id: number; code: string; name: string };
type CardRef = { id: number; name: string };

type EntryWithRefs = LedgerEntry & {
  categoryAccount?: CategoryRef | null;
  chargeToCard?: CardRef | null;
};

export type BankTxnDto = {
  id: number;
  accountId: number;
  date: Date;
  description: string;
  amount: number;
  balance: number | null;
  source: TxnSource;
  externalId: string | null;
  categoryAccountId: number | null;
  postedRecordId: number | null;
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
  source: TxnSource;
  externalId: string | null;
  categoryAccountId: number | null;
  postedRecordId: number | null;
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
    date: e.date,
    description: e.description,
    amount: Number(e.amount),
    balance: e.balance ? Number(e.balance) : null,
    source: e.source,
    externalId: e.externalId,
    categoryAccountId: e.categoryAccountId,
    postedRecordId: e.postedRecordId,
    transferGroupId: e.transferGroupId,
    chargeToAccountId: e.chargeToCardId,
    chargeGroupId: e.chargeGroupId,
    createdAt: e.createdAt,
    ...(e.categoryAccount !== undefined ? { categoryAccount: e.categoryAccount } : {}),
    ...(e.chargeToCard !== undefined ? { chargeToAccount: e.chargeToCard } : {}),
  };
}

/** カード明細を API の応答の形（以前の card_transactions と同じ項目名・符号）にする */
export function toCardTxn(e: EntryWithRefs): CardTxnDto {
  return {
    id: e.id,
    accountId: e.cardAccountId!,
    date: e.date,
    description: e.description,
    amount: cardSpend(e.amount),
    source: e.source,
    externalId: e.externalId,
    categoryAccountId: e.categoryAccountId,
    postedRecordId: e.postedRecordId,
    transferToAccountId: e.chargeToCardId,
    chargeGroupId: e.chargeGroupId,
    createdAt: e.createdAt,
    ...(e.categoryAccount !== undefined ? { categoryAccount: e.categoryAccount } : {}),
    ...(e.chargeToCard !== undefined ? { transferToAccount: e.chargeToCard } : {}),
  };
}

/** 一覧で添える科目とチャージ先 */
export const ENTRY_REFS_INCLUDE = {
  categoryAccount: { select: { id: true, code: true, name: true } },
  chargeToCard: { select: { id: true, name: true } },
} as const satisfies Prisma.LedgerEntryInclude;

export type ExternalEntryRow = {
  externalId: string;
  date: string | Date;
  description: string;
  /** +入金 / −出金（銀行・カードとも CSV の生の明細の符号） */
  amount: number;
  balance?: number | null;
};

// 外部由来（CSV 取込・自動同期）の明細を登録する。
// 一括 createMany + skipDuplicates で、口座ごとの externalId の一意制約により重複行は自動的にスキップされる。
// 摘要が txn_category_rules に一致する場合は categoryAccountId を自動で埋める
// （転記は行わない。人の操作による PATCH /categorize でのみ実績へ転記する）。
// カードは、取り込む先のカードのチャージのルール（card_transfer_rules）に当たった行をチャージにし、科目を付けない。
// 返り値は実際に新規作成された件数（重複でスキップされた行は含まない）。
export async function insertExternalEntries(
  db: TenantDb,
  tenantId: number,
  target: { kind: "BANK" | "CARD"; accountId: number },
  rows: ExternalEntryRow[],
  source: Extract<TxnSource, "CSV" | "SYNC">,
): Promise<number> {
  if (rows.length === 0) return 0;

  const [rules, transferRules] = await Promise.all([
    db.txnCategoryRule.findMany({
      select: { keyword: true, categoryAccountId: true, priority: true },
    }),
    // チャージ判定は取り込む先のカードに紐付いたルールだけを見る
    // （同じ摘要が別のカードでは通常の利用を指すことがあるため）
    target.kind === "CARD"
      ? db.cardTransferRule.findMany({
          where: { accountId: target.accountId },
          select: { keyword: true, transferToAccountId: true },
        })
      : Promise.resolve([]),
  ]);

  const { count } = await db.ledgerEntry.createMany({
    data: rows.map((r) => {
      const chargeToCardId =
        target.kind === "CARD" ? resolveTransferTarget(r.description, transferRules) : null;
      return {
        tenantId,
        kind: target.kind,
        ...(target.kind === "BANK"
          ? { bankAccountId: target.accountId, balance: r.balance ?? null }
          : { cardAccountId: target.accountId }),
        date: new Date(r.date),
        description: r.description,
        amount: r.amount,
        source,
        externalId: r.externalId,
        // チャージ（資金移動）と判定した行は支出ではないので科目を付けない
        categoryAccountId: chargeToCardId === null ? classifyByRules(r.description, rules) : null,
        chargeToCardId,
      };
    }),
    skipDuplicates: true,
  });
  return count;
}
