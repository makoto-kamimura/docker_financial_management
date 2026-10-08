import { randomUUID } from "node:crypto";
import type { TenantDbClient } from "@/lib/tenant-db";
import { confirmedActualsPeriodIds } from "@/lib/budget-lock";
import { isChargeableType } from "@/lib/linked-account-type";

// 送金と受金の自動相殺。
//
// 自分の口座・カードの間で、同じ日に同じ金額の出金と入金があれば、お金の置き場所が変わっただけなので
// 収入・支出から外す（振替・チャージの組にする）。組の候補が 1 組だけのときに限る
// （同じ日・同じ金額の出金や入金が複数あると、どれとどれが対になるか決められないため）。
//
//   - 銀行 → 銀行: 口座間振替（両方に同じ transferGroupId）
//   - 銀行 → デビット・プリペイド・電子マネー: チャージ（出金側にチャージ先、両方に同じ chargeGroupId）
//   - カード → プリペイド・電子マネー（別のカード）: カードのチャージ（同上）
// クレジットカードは後払いで残高を持たないので、入金側（チャージ先）にはならない。
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
  if (out.kind === "BANK" && inn.kind === "BANK") return "transfer";
  if (inn.kind === "CARD" && isChargeableType(inn.cardType ?? "")) return "charge";
  return null;
}

/**
 * 同じ日・同じ金額・符号が逆の明細の組のうち、出金側にも入金側にも候補がほかに無いものを返す（純関数）。
 * 渡すのは、まだ振替・チャージの組になっていない明細だけ。
 */
export function findOffsetPairs(entries: OffsetEntry[]): OffsetPair[] {
  const outs = entries.filter((e) => e.flow < 0);
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
  const pairs: OffsetPair[] = [];
  for (const out of outs) {
    const list = candidates.get(out.id) ?? [];
    if (list.length !== 1) continue;
    const inn = list[0];
    if ((reverse.get(inn.id) ?? []).length !== 1) continue;
    const type = pairType(out, inn)!;
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
      chargeToCardId: null,
      chargeGroupId: null,
      ...(range ? { date: range } : {}),
    },
    select: {
      id: true,
      kind: true,
      bankAccountId: true,
      cardAccountId: true,
      date: true,
      flow: true,
      periodId: true,
      cardAccount: { select: { type: true } },
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
    }));

  const pairs = findOffsetPairs(entries);
  for (const p of pairs) {
    // 組は収入・支出ではないので、付いていた科目は外す
    const clear = { accountId: null, amount: 0 };
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
