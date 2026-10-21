import { randomUUID } from "node:crypto";
import type { TenantDbClient } from "@/lib/server/tenant-db";
import { confirmedActualsPeriodIds } from "@/lib/budget/budget-lock";
import { CHARGEABLE_TYPES, isChargeableType } from "@/lib/shared/linked-account-type";
import { PAIRED_CLEAR } from "@/lib/ledger/business-use";

// 送金と受金の自動相殺。
//
// 自分の口座・カードの間で、同じ日に同じ金額の出金と入金があれば、お金の置き場所が変わっただけなので
// 収入・支出から外す（振替・チャージの組にする）。組の候補が 1 組に決まるときに限る
// （同じ日・同じ金額の出金や入金が複数あると、どれとどれが対になるか決められないため）。
// 候補が複数あれば、摘要に相手の口座・カードの名前が出ているもの（例: JAL Pay の入金「住信SBIネット銀行」は
// 住信SBIネット銀行の口座からの出金）に絞る。絞っても残る候補が互いに区別の付かない明細
// （同じ口座・同じ日・同じ金額・同じチャージ先）だけなら、どれと組んでも同じなので id の小さいものと組む。
//
//   - 銀行 → 銀行: 口座間振替（両方に同じ transferGroupId）
//   - 銀行 → デビット・プリペイド・電子マネー: チャージ（出金側にチャージ先、両方に同じ chargeGroupId）
//   - カード → プリペイド・電子マネー（別のカード）: カードのチャージ（同上）
// クレジットカードは後払いで残高を持たないので、入金側（チャージ先）にはならない。
// 取り込みのルールでチャージ先だけが付いた出金（対の無いチャージ）も、そのチャージ先の入金と組にする。
// 組にした明細は科目を外し、実績から抜ける。実績を確定済みの月の明細は対象にしない。

export type OffsetEntry = {
  id: number;
  kind: "BANK" | "CARD";
  /** 銀行は口座 id、カードはカード id */
  accountId: number;
  /** カードの種別（CREDIT_CARD など）。銀行は null */
  cardType: string | null;
  /** 取引日（YYYY-MM-DD） */
  ymd: string;
  /** +入金 / −出金 */
  flow: number;
  /** 摘要（候補が複数あるときの手がかり） */
  description?: string;
  /** 自分の口座・カードを指す名前（口座名・銀行名、カード名・発行元など。候補が複数あるときの手がかり） */
  labels?: string[];
  /** チャージ先だけが付いた出金（対の無いチャージ）のチャージ先。相手はこのカードの入金だけ */
  chargeTo?: number | null;
};

export type OffsetPair = {
  outId: number;
  inId: number;
  type: "transfer" | "charge";
  /** チャージのときのチャージ先カード */
  chargeToCardId: number | null;
};

/** 出金 out と入金 inn を組にできるか。できるなら組の種類 */
function pairType(out: OffsetEntry, inn: OffsetEntry): OffsetPair["type"] | null {
  if (out.kind === inn.kind && out.accountId === inn.accountId) return null;
  if (out.chargeTo != null) {
    return inn.kind === "CARD" && inn.accountId === out.chargeTo ? "charge" : null;
  }
  if (out.kind === "BANK" && inn.kind === "BANK") return "transfer";
  if (inn.kind === "CARD" && isChargeableType(inn.cardType ?? "")) return "charge";
  return null;
}

const normalize = (text: string) => text.normalize("NFKC").toUpperCase().replace(/\s+/g, "");

/** 摘要 description に、名前 labels のどれかが出ているか（全角・半角、大文字・小文字、空白は区別しない） */
function mentions(description: string | undefined, labels: string[] | undefined): boolean {
  if (!description || !labels) return false;
  const d = normalize(description);
  return labels.some((l) => {
    const n = normalize(l);
    return n.length >= 2 && d.includes(n);
  });
}

/**
 * 候補が複数あるとき、摘要の手がかりで絞る。自分の摘要に相手の名前が出ている候補、相手の摘要に自分の
 * 名前が出ている候補の順に絞り、絞れなかった（全部残る・全部消える）手がかりは使わない。
 */
function narrow(self: OffsetEntry, candidates: OffsetEntry[]): OffsetEntry[] {
  let list = candidates;
  for (const hit of [
    (c: OffsetEntry) => mentions(self.description, c.labels),
    (c: OffsetEntry) => mentions(c.description, self.labels),
  ]) {
    if (list.length <= 1) break;
    const hits = list.filter(hit);
    if (hits.length > 0 && hits.length < list.length) list = hits;
  }
  return list;
}

/** 区別の付かない明細（どれと組んでも結果が同じ）か */
const sameKey = (e: OffsetEntry) =>
  `${e.kind}:${e.accountId}:${e.ymd}:${e.flow}:${e.chargeTo ?? ""}`;

/** 候補から 1 つに決める。1 つだけか、区別の付かない明細だけなら id の小さいもの。決められなければ null */
function pick(candidates: OffsetEntry[]): OffsetEntry | null {
  if (candidates.length === 0) return null;
  const key = sameKey(candidates[0]);
  if (!candidates.every((c) => sameKey(c) === key)) return null;
  return candidates.reduce((a, b) => (b.id < a.id ? b : a));
}

/**
 * 同じ日・同じ金額・符号が逆の明細の組のうち、出金側から見ても入金側から見ても相手が 1 つに決まるものを返す（純関数）。
 * 渡すのは、まだ振替・チャージの組になっていない明細（と、対の無いチャージの出金）だけ。
 * 出金を id 順に見て、組にした明細は以降の候補から外す。
 */
export function findOffsetPairs(entries: OffsetEntry[]): OffsetPair[] {
  const outs = entries.filter((e) => e.flow < 0).sort((a, b) => a.id - b.id);
  const ins = entries.filter((e) => e.flow > 0);
  const candidates = new Map<number, OffsetEntry[]>();
  const reverse = new Map<number, OffsetEntry[]>();
  for (const out of outs) {
    for (const inn of ins) {
      if (inn.ymd !== out.ymd || inn.flow !== -out.flow || pairType(out, inn) === null) continue;
      candidates.set(out.id, [...(candidates.get(out.id) ?? []), inn]);
      reverse.set(inn.id, [...(reverse.get(inn.id) ?? []), out]);
    }
  }
  const used = new Set<number>();
  const free = (list: OffsetEntry[] | undefined) => (list ?? []).filter((e) => !used.has(e.id));
  const pairs: OffsetPair[] = [];
  for (const out of outs) {
    const inn = pick(narrow(out, free(candidates.get(out.id))));
    if (!inn) continue;
    // 入金の側から見ても、この出金に決まるときだけ組にする
    if (pick(narrow(inn, free(reverse.get(inn.id))))?.id !== out.id) continue;
    const type = pairType(out, inn)!;
    used.add(out.id);
    used.add(inn.id);
    pairs.push({
      outId: out.id,
      inId: inn.id,
      type,
      chargeToCardId: type === "charge" ? inn.accountId : null,
    });
  }
  return pairs;
}

const pad = (n: number) => String(n).padStart(2, "0");
/** 日付のサーバーの年月日（期間の解決と同じ） */
export const ymdOf = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 明細の口座・カードを指す名前（摘要の手がかり）。クレジットカードは摘要に「クレジットカード」と出ることが多い */
function labelsOf(r: {
  bankAccount: { name: string; bankName: string } | null;
  cardAccount: { type: string; name: string; institution: string } | null;
}): string[] {
  if (r.bankAccount) return [r.bankAccount.name, r.bankAccount.bankName];
  if (!r.cardAccount) return [];
  return [
    r.cardAccount.name,
    r.cardAccount.institution,
    ...(r.cardAccount.type === "CREDIT_CARD" ? ["クレジットカード"] : []),
  ];
}

/**
 * 指定した日付（無ければ全期間）の明細に自動相殺をかけ、組にした数を返す。
 * 実績を確定済みの月の明細は対象にしない。
 */
export async function applyAutoOffset(
  db: TenantDbClient,
  dates?: Date[],
): Promise<{ pairs: number }> {
  let range: { gte: Date; lt: Date } | undefined;
  let days: Set<string> | undefined;
  if (dates) {
    if (dates.length === 0) return { pairs: 0 };
    const times = dates.map((d) => d.getTime());
    // 時刻の扱いの違いで日がずれないよう、前後 1 日広く読んでから年月日で絞る
    range = {
      gte: new Date(Math.min(...times) - 86_400_000),
      lt: new Date(Math.max(...times) + 2 * 86_400_000),
    };
    days = new Set(dates.map(ymdOf));
  }

  const rows = await db.financialRecord.findMany({
    where: {
      kind: { in: ["BANK", "CARD"] },
      transferGroupId: null,
      chargeGroupId: null,
      ...(range ? { date: range } : {}),
      OR: [
        { chargeToCardId: null },
        // 取り込みのルールなどでチャージ先だけが付いた出金（対の無いチャージ）。
        // チャージ先がクレジットカードのもの（カード代金の引き落とし）は対を持たないので読まない
        { flow: { lt: 0 }, chargeToCard: { type: { in: CHARGEABLE_TYPES } } },
      ],
    },
    select: {
      id: true,
      kind: true,
      bankAccountId: true,
      cardAccountId: true,
      date: true,
      flow: true,
      description: true,
      periodId: true,
      chargeToCardId: true,
      bankAccount: { select: { name: true, bankName: true } },
      cardAccount: { select: { type: true, name: true, institution: true } },
    },
  });
  const locked = await confirmedActualsPeriodIds(
    db,
    rows.map((r) => r.periodId),
  );
  const entries: OffsetEntry[] = rows
    .filter((r) => !locked.has(r.periodId) && (!days || days.has(ymdOf(r.date!))))
    .map((r) => ({
      id: r.id,
      kind: r.kind as "BANK" | "CARD",
      accountId: (r.bankAccountId ?? r.cardAccountId)!,
      cardType: r.cardAccount?.type ?? null,
      ymd: ymdOf(r.date!),
      flow: Number(r.flow),
      description: r.description ?? undefined,
      labels: labelsOf(r),
      chargeTo: r.chargeToCardId,
    }));

  const pairs = findOffsetPairs(entries);
  for (const p of pairs) {
    // 組は収入・支出ではないので、付いていた科目は外す
    const clear = PAIRED_CLEAR;
    if (p.type === "transfer") {
      const transferGroupId = randomUUID();
      await db.financialRecord.updateMany({
        where: { id: { in: [p.outId, p.inId] } },
        data: { transferGroupId, ...clear },
      });
    } else {
      const chargeGroupId = randomUUID();
      await db.financialRecord.update({
        where: { id: p.outId },
        data: { chargeToCardId: p.chargeToCardId, chargeGroupId, ...clear },
      });
      await db.financialRecord.update({
        where: { id: p.inId },
        data: { chargeGroupId, ...clear },
      });
    }
  }
  return { pairs: pairs.length };
}
