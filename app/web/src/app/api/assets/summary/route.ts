import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/server/api-handler";
import { withCache } from "@/lib/server/redis";
import { summarizeNetWorth, type NetWorthAccountBalance } from "@/lib/assets/asset-summary";
import { buildBankBalanceMap } from "@/lib/ledger/bank-balance";
import { estimateAssetValue, VALUATION_INCLUDE } from "@/lib/assets/personal-asset-valuation";
import { loanBalanceAt } from "@/lib/assets/loan-balance";
import { ACTUAL_WHERE, actualRows } from "@/lib/ledger/actuals";

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

// GET /api/assets/summary?year=&month= … 総資産（純資産）サマリ（Redis キャッシュ 1 時間）
//   指定した月の時点で出す（ダッシュボードの KPI の対象月）。時点は月末、今月なら今日（asOf で返す）。
//   - 実物資産: 評価額の推移の見積もり（lib/shared/asset-valuation.ts）の、その時点の値
//   - 預貯金: その時点までの明細の合計 + 差額
//   - 借入金: その時点の残高（返済の記録があれば記録から、無ければ返済予定から。lib/assets/loan-balance.ts）
//   - 資産・負債科目: その月以前でいちばん新しい月の残高
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({
    year: z.coerce.number().int().optional(),
    month: z.coerce.number().int().min(1).max(12).optional(),
  }),
  handler: async ({ user, db, query }) => {
    const { tenantId } = user;
    const now = new Date();
    const year = query.year ?? now.getFullYear();
    const month = query.month ?? now.getMonth() + 1;
    const cacheKey = `assets:summary:${tenantId}:${year}-${month}`;
    const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;
    // 時点: 今月は今日、それ以外は月末
    const asOf = isCurrentMonth ? now : new Date(year, month, 0);
    const nextMonthStart = new Date(year, month, 1);

    const payload = await withCache(cacheKey, 3600, async () => {
      const [
        personalAssets,
        bankSums,
        records,
        loans,
        linkedAccounts,
        bankAccountMappings,
        bankAccounts,
      ] = await Promise.all([
        db.personalAsset.findMany({
          where: { tenantId },
          include: { loan: { include: { repayments: true } }, ...VALUATION_INCLUDE },
        }),
        db.financialRecord.groupBy({
          by: ["bankAccountId"],
          _sum: { flow: true },
          where: { kind: "BANK", date: { lt: nextMonthStart } },
        }),
        db.financialRecord
          .findMany({
            where: {
              tenantId,
              ...ACTUAL_WHERE,
              account: { category: { in: ["ASSET", "LIABILITY"] } },
              period: {
                OR: [{ fiscalYear: { lt: year } }, { fiscalYear: year, month: { lte: month } }],
              },
            },
            include: {
              account: { select: { id: true, category: true } },
              period: { select: { fiscalYear: true, month: true } },
            },
          })
          .then(actualRows),
        // D-4: 実物資産の紐付け負債（personalAsset あり）は personalAssetDebts 側で
        // スケジュール計算した残高を計上するため、ここでは除外して二重計上を防ぐ。
        // 時点より後に返した元金は、今の残高に足し戻す
        db.loan.findMany({
          where: {
            tenantId,
            personalAsset: { is: null },
            borrowedOn: { lt: nextMonthStart },
          },
          include: { repayments: true },
        }),
        db.linkedAccount.findMany({
          where: { tenantId, accountId: { not: null } },
          select: { accountId: true },
        }),
        // D-1: 銀行口座の勘定科目紐付けは bank_accounts.accountId に統合された
        db.bankAccount.findMany({
          where: { tenantId, accountId: { not: null } },
          select: { accountId: true },
        }),
        // 残高の差額（期首残高相当）を含めるため口座も引く（lib/ledger/bank-balance.ts）
        db.bankAccount.findMany({
          where: { tenantId },
          select: { id: true, balanceAdjustment: true },
        }),
      ]);

      // 口座残高は口座サマリと同じ定義（明細合計 + 差額）で算出する
      const bankBalanceMap = buildBankBalanceMap(
        bankAccounts,
        bankSums.map((b) => ({ accountId: b.bankAccountId!, sum: b._sum.flow?.toNumber() ?? 0 })),
      );

      // 科目ごとに「指定した月以前で最も新しい月」のスナップショットを残高として採用する
      const latestByAccount = new Map<
        number,
        { category: "ASSET" | "LIABILITY"; ym: number; amount: number }
      >();
      for (const r of records) {
        const category = r.account.category as "ASSET" | "LIABILITY";
        const existing = latestByAccount.get(r.accountId);
        const ym = r.period.fiscalYear * 12 + r.period.month;
        if (!existing || ym > existing.ym) {
          latestByAccount.set(r.accountId, { category, ym, amount: Number(r.amount) });
        }
      }
      const accountBalances: NetWorthAccountBalance[] = [...latestByAccount.entries()].map(
        ([accountId, v]) => ({ accountId, category: v.category, balance: v.amount }),
      );

      // ローンの残高はどれも借入金管理と同じ計算（lib/assets/loan-balance.ts）。まだ借りていなければ 0
      const personalAssetDebts = personalAssets
        .filter((a) => a.loan !== null)
        .map((a) => ({ remaining: loanBalanceAt(a.loan!, asOf) }));

      const result = summarizeNetWorth({
        personalAssets: personalAssets.map((a) => ({
          // その時点の評価額の見積もり（まだ持っていなければ 0）
          currentValue: Math.round(estimateAssetValue(a, asOf) ?? 0),
          countAsAsset: a.countAsAsset,
          // 二重計上の除外に使う負債科目: ローンの予算連携先（無ければ以前の資産側の紐付け負債科目）
          linkedAccountId: a.loan?.linkedAccountId ?? a.linkedAccountId,
        })),
        bankBalances: [...bankBalanceMap.entries()].map(([accountId, balance]) => ({
          accountId,
          balance,
        })),
        accountBalances,
        loans: loans.map((l) => ({ remainingAmount: loanBalanceAt(l, asOf) })),
        linkedAccountMappings: [...bankAccountMappings, ...linkedAccounts].map((l) => ({
          accountId: l.accountId!,
        })),
        personalAssetDebts,
      });

      return { year, month, asOf: ymd(asOf), isCurrentMonth, ...result };
    });

    return NextResponse.json(payload);
  },
});
