import type { TenantDbClient } from "@/lib/tenant-db";
import { LINKED_ACCOUNT_TYPE_LABELS, type LinkedAccountType } from "@/lib/linked-account-type";

// 実績がどこまで入力済みかの判定（実績管理の「実績の確定」＝ ② の前提）。
//
// 銀行口座・カード・電子マネーごとに、取り込んだ明細の最終日（取引日の最大値）を出す。
// 明細が 1 件以上あるソースの最終日のうち一番古い日（coveredThrough）が月末日以降なら、
// その月の明細は全ソースでそろった＝「実績入力済み」とみなす（最終日の当日も入力済みに含める）。
// 明細が 1 件も無いソースは判定から外す（使っていないカードがあると永久に進めなくなるため）。
// 日付は resolvePeriodForDate と同じくサーバーのローカル時刻の年月日で扱う。

export type ActualsSource = {
  kind: "bank" | "card";
  id: number;
  name: string;
  /** 種別の表示名（銀行口座 / クレジットカード / 電子マネー など） */
  typeLabel: string;
  /** 明細の最終日（YYYY-MM-DD）。明細が無ければ null */
  lastDate: string | null;
};

export type ActualsCoverage = {
  /** 対象月の月末日（YYYY-MM-DD） */
  monthEnd: string;
  /** 明細があるソースの最終日のうち一番古い日。明細のあるソースが無ければ null */
  coveredThrough: string | null;
  /** 全ソースの明細が月末日までそろっているか */
  entered: boolean;
  /** 月末日に届いていないソース（明細なしは含めない） */
  lagging: { kind: ActualsSource["kind"]; id: number }[];
};

const pad = (n: number) => String(n).padStart(2, "0");

export function toYmd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function monthEndYmd(year: number, month: number): string {
  // 翌月 0 日 ＝ 当月の末日
  return `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;
}

export function judgeActualsCoverage(
  sources: ActualsSource[],
  year: number,
  month: number,
): ActualsCoverage {
  const monthEnd = monthEndYmd(year, month);
  const dated = sources.filter((s): s is ActualsSource & { lastDate: string } => !!s.lastDate);
  const coveredThrough =
    dated.length === 0
      ? null
      : dated.reduce((min, s) => (s.lastDate < min ? s.lastDate : min), dated[0].lastDate);
  return {
    monthEnd,
    coveredThrough,
    entered: coveredThrough !== null && coveredThrough >= monthEnd,
    lagging: dated.filter((s) => s.lastDate < monthEnd).map((s) => ({ kind: s.kind, id: s.id })),
  };
}

// 「当月末まで変動なし」（実績の確定タブで行ごとに付ける印）。明細が月末まで届いていないソースでも、
// 最終日のあと月末まで取引が無いと利用者が申告したものは、そろったものとして扱う。
export type SourceRef = { kind: ActualsSource["kind"]; id: number };

const refKey = (r: SourceRef) => `${r.kind}:${r.id}`;

/**
 * 変動なしの印を考えても、まだ月末まで届いていないソース。空なら実績を確定できる。
 * 月末まで届いているソースへの印は意味が無いので無視する。
 */
export function remainingLagging(coverage: ActualsCoverage, noChange: SourceRef[]): SourceRef[] {
  const marked = new Set(noChange.map(refKey));
  return coverage.lagging.filter((l) => !marked.has(refKey(l)));
}

/** 実績の確定時に記録する、確定時点の明細の状況（actuals_confirmations.coverage） */
export type CoverageSnapshot = {
  monthEnd: string;
  coveredThrough: string | null;
  sources: (ActualsSource & { noChange: boolean })[];
};

export function buildCoverageSnapshot(
  sources: ActualsSource[],
  coverage: ActualsCoverage,
  noChange: SourceRef[],
): CoverageSnapshot {
  const lagging = new Set(coverage.lagging.map(refKey));
  const marked = new Set(noChange.map(refKey).filter((k) => lagging.has(k)));
  return {
    monthEnd: coverage.monthEnd,
    coveredThrough: coverage.coveredThrough,
    sources: sources.map((s) => ({ ...s, noChange: marked.has(refKey(s)) })),
  };
}

/** 銀行口座・カード台帳の全ソースと、それぞれの明細の最終日 */
export async function loadActualsSources(
  db: Pick<TenantDbClient, "bankAccount" | "bankTransaction" | "linkedAccount" | "cardTransaction">,
  tenantId: number,
): Promise<ActualsSource[]> {
  const [banks, cards, bankMax, cardMax] = await Promise.all([
    db.bankAccount.findMany({
      where: { tenantId },
      select: { id: true, name: true },
      orderBy: { id: "asc" },
    }),
    db.linkedAccount.findMany({
      where: { tenantId },
      select: { id: true, name: true, type: true },
      orderBy: { id: "asc" },
    }),
    db.bankTransaction.groupBy({
      by: ["accountId"],
      _max: { date: true },
      where: { account: { tenantId } },
    }),
    db.cardTransaction.groupBy({
      by: ["accountId"],
      _max: { date: true },
      where: { account: { tenantId } },
    }),
  ]);
  const bankLast = new Map(bankMax.map((b) => [b.accountId, b._max.date]));
  const cardLast = new Map(cardMax.map((c) => [c.accountId, c._max.date]));
  return [
    ...banks.map((b) => {
      const last = bankLast.get(b.id);
      return {
        kind: "bank" as const,
        id: b.id,
        name: b.name,
        typeLabel: "銀行口座",
        lastDate: last ? toYmd(last) : null,
      };
    }),
    ...cards.map((c) => {
      const last = cardLast.get(c.id);
      return {
        kind: "card" as const,
        id: c.id,
        name: c.name,
        typeLabel: LINKED_ACCOUNT_TYPE_LABELS[c.type as LinkedAccountType] ?? c.type,
        lastDate: last ? toYmd(last) : null,
      };
    }),
  ];
}

/**
 * 対象月の明細のうち、実績にまだ転記していないものの件数（参考表示。確定は止めない）。
 * 口座間振替・チャージは転記の対象外なので数えない。
 */
export async function countUnpostedTxns(
  db: Pick<TenantDbClient, "bankTransaction" | "cardTransaction">,
  tenantId: number,
  year: number,
  month: number,
): Promise<number> {
  const date = { gte: new Date(year, month - 1, 1), lt: new Date(year, month, 1) };
  const [bank, card] = await Promise.all([
    db.bankTransaction.count({
      where: {
        account: { tenantId },
        date,
        postedRecordId: null,
        transferGroupId: null,
        chargeToAccountId: null,
        chargeGroupId: null,
      },
    }),
    db.cardTransaction.count({
      where: {
        account: { tenantId },
        date,
        postedRecordId: null,
        transferToAccountId: null,
        chargeGroupId: null,
      },
    }),
  ]);
  return bank + card;
}

/** 対象月の実績の入力状況（ソース一覧・判定・未転記件数） */
export async function loadActualsCoverage(
  db: Pick<TenantDbClient, "bankAccount" | "bankTransaction" | "linkedAccount" | "cardTransaction">,
  tenantId: number,
  year: number,
  month: number,
) {
  const [sources, unposted] = await Promise.all([
    loadActualsSources(db, tenantId),
    countUnpostedTxns(db, tenantId, year, month),
  ]);
  return { sources, unposted, ...judgeActualsCoverage(sources, year, month) };
}
