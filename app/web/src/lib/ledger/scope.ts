// 実績の範囲（scope）。家庭・法人モードは全件・全額（household）、個人事業主モードは事業の分だけ（business）。
//
// business では、明細（現金・銀行・カード）は事業利用の印の付いた行だけを、按分した額で数える。
// 明細でない行（仕訳・減価償却・棚卸・売掛買掛・過去の直接入力）は事業の行として全額を数える。
// 口座・カード・資産・借入金は、事業利用の印の付いたものだけを出す（businessOwnedWhere）。
// 画面は表示モードから scope を決めて、API のクエリ（?scope=business）で渡す（lib/client/use-view-mode.ts）。
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { ACTUAL_WHERE } from "@/lib/ledger/actuals";
import { businessPortion } from "@/lib/shared/business-use";

export type ActualsScope = "household" | "business";

/** API のクエリの scope（省略は household） */
export const ScopeQuery = z.object({
  scope: z.enum(["household", "business"]).default("household"),
});

/** 実績として数える行（scope の範囲） */
export function actualWhere(scope: ActualsScope): Prisma.FinancialRecordWhereInput {
  if (scope === "household") return ACTUAL_WHERE;
  return { ...ACTUAL_WHERE, OR: [{ kind: null }, { businessUse: true }] };
}

/** scopedAmount に要る列（select で読むときに足す） */
export const SCOPE_SELECT = { kind: true, businessUse: true, businessRatio: true } as const;

type ScopedRow = {
  amount: unknown;
  kind: unknown;
  businessUse: boolean;
  businessRatio: unknown;
};

/** その行が scope で数える実績の額（household は全額。business は事業の分。範囲外は 0） */
export function scopedAmount(r: ScopedRow, scope: ActualsScope): number {
  const amount = Number(r.amount);
  if (scope === "household" || r.kind === null) return amount;
  if (!r.businessUse || r.businessRatio === null) return 0;
  return businessPortion(amount, Number(r.businessRatio));
}

/** 口座・カード・資産・借入金の絞り込み（business は事業利用の印の付いたものだけ） */
export function businessOwnedWhere(scope: ActualsScope): { businessUse?: true } {
  return scope === "business" ? { businessUse: true } : {};
}
