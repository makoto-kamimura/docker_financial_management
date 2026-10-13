// 予算の範囲。家庭・法人モードの予算（HOUSEHOLD）と、個人事業主モードの事業の予算（BUSINESS）を分けて持つ。
// 画面は実績と同じ ?scope=household|business で送り（lib/ledger/scope.ts の ScopeQuery）、ここで予算の範囲に直す。
// 予算の確定も範囲ごと。実績の確定は家庭と事業で共通（月に 1 回）。
import type { BudgetScope } from "@prisma/client";
import type { ActualsScope } from "@/lib/shared/business-use";

export type { BudgetScope };

export function budgetScopeOf(scope: ActualsScope): BudgetScope {
  return scope === "business" ? "BUSINESS" : "HOUSEHOLD";
}
