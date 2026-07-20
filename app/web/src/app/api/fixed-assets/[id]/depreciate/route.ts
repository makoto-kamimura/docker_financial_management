import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { resolvePeriod } from "@/lib/period";

// D-5d-4: 償却費科目。従来は実在しない "H3400" を参照しており実績連動が常に no-op になっていた
// （調査で判明した既存バグの修正）。モード別の科目コード（個人事業主 7600 / 法人 C7300）に対応する。
const DEPRECIATION_EXPENSE_ACCOUNT_CODES = ["7600", "C7300"];
// 減価償却累計額（対照科目）。現状どのテナントにも未整備のため、存在する場合のみ監査証跡仕訳を作る。
const ACCUMULATED_DEPRECIATION_ACCOUNT_CODE = "2400";

// POST /api/fixed-assets/[id]/depreciate?year= … 年次償却の計上（editor 以上）
export const POST = withApi({
  role: "editor",
  querySchema: z.object({ year: z.coerce.number().int().optional() }),
  handler: async ({ user, db, id, query }) => {
    const { tenantId } = user;
    const fiscalYear = query.year ?? new Date().getFullYear();

    const asset = await db.fixedAsset.findUnique({ where: { id, tenantId } });
    if (!asset) throw notFound();
    if (asset.disposedOn) throw badRequest("disposed asset");

    const existing = await db.depreciation.findUnique({
      where: { fixedAssetId_fiscalYear: { fixedAssetId: asset.id, fiscalYear } },
    });
    if (existing) throw badRequest(`${fiscalYear}年度の償却は既に計上済みです`);

    const cost = Number(asset.acquisitionCost);
    const bookValue = Number(asset.bookValue);
    const usefulLife = asset.usefulLife;

    let amount: number;
    if (asset.method === "straight") {
      const residual = cost * Number(asset.residualRate);
      amount = Math.floor((cost - residual) / usefulLife);
    } else {
      const rate = (1 / usefulLife) * 2;
      amount = Math.floor(bookValue * rate);
    }
    amount = Math.min(amount, Math.max(bookValue - 1, 0));

    const [depreciation] = await db.$transaction([
      db.depreciation.create({ data: { fixedAssetId: asset.id, fiscalYear, amount } }),
      db.fixedAsset.update({
        where: { id: asset.id },
        data: { bookValue: { decrement: amount } },
      }),
    ]);

    const deprAccount = await db.account.findFirst({
      where: { tenantId, code: { in: DEPRECIATION_EXPENSE_ACCOUNT_CODES } },
    });
    if (deprAccount) {
      const period = await resolvePeriod(db, tenantId, fiscalYear, 12);
      await db.financialRecord.create({
        data: { tenantId, accountId: deprAccount.id, periodId: period.id, amount },
      });

      // D-5d-4: 監査証跡として複式仕訳（Dr 減価償却費/Cr 減価償却累計額）も記録する
      // （対照科目が整備されている場合のみ）。choke-point 同期は呼ばない — 既に上で直接
      // FinancialRecord を書いているため、同期すると同じ科目に二重計上してしまう。
      const accumulatedAccount = await db.account.findFirst({
        where: { tenantId, code: ACCUMULATED_DEPRECIATION_ACCOUNT_CODE },
      });
      if (accumulatedAccount) {
        await db.journalEntry.create({
          data: {
            tenantId,
            transactionDate: new Date(fiscalYear, 11, 31),
            description: `${asset.name} ${fiscalYear}年度償却（自動仕訳）`,
            paymentMethod: "other",
            taxCategory: "non_taxable",
            details: {
              create: [
                { side: "debit", accountId: deprAccount.id, amount },
                { side: "credit", accountId: accumulatedAccount.id, amount },
              ],
            },
          },
        });
      }
    }

    return NextResponse.json({ data: depreciation }, { status: 201 });
  },
});
