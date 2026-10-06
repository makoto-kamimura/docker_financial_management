import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest } from "@/lib/api-error";
import { findAccountByCode } from "@/lib/period";
import { invalidateCache } from "@/lib/redis";
import { LOAN_INCLUDE, loanBalanceAt } from "@/lib/loan-balance";
import { PERSONAL_ASSET_CATEGORIES } from "@/lib/personal-asset";
import { recordValuation, ruleOfRow } from "@/lib/personal-asset-valuation";

// この借入で買った資産（任意）。その場で作るか、ローンの無い既存の資産にひも付ける
const LoanAssetSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("new"),
    name: z.string().min(1),
    category: z.enum(PERSONAL_ASSET_CATEGORIES).default("OTHER"),
    acquiredOn: z.string().optional(),
    acquisitionCost: z.number().min(0).optional(),
    currentValue: z.number().min(0),
  }),
  z.object({ mode: z.literal("link"), assetId: z.number().int() }),
]);

const LoanSchema = z.object({
  lenderName: z.string().min(1),
  amount: z.number().positive(),
  interestRate: z.number().min(0).default(0),
  borrowedOn: z.string().min(1),
  repaymentDate: z.string().min(1),
  note: z.string().optional(),
  loanType: z.string().optional(),
  linkedAccountCode: z.string().optional(),
  monthlyPayment: z.number().optional(),
  // 残価設定ローンの据置額（最終回に一括支払い）。カーローン等
  residualValue: z.number().min(0).nullable().optional(),
  asset: LoanAssetSchema.optional(),
});

// GET /api/loans?status=active … 借入金一覧
//   remainingAmount は今日の時点の残高（lib/loan-balance.ts）。返済の記録が無いローンも返済予定どおりに減る
export const GET = withApi({
  role: "viewer",
  querySchema: z.object({ status: z.string().optional() }),
  handler: async ({ user, db, query }) => {
    const loans = await db.loan.findMany({
      where: { tenantId: user.tenantId, ...(query.status ? { status: query.status } : {}) },
      include: LOAN_INCLUDE,
      orderBy: { borrowedOn: "desc" },
    });
    const now = new Date();
    const data = loans.map((l) => ({ ...l, remainingAmount: String(loanBalanceAt(l, now)) }));
    return NextResponse.json({ data });
  },
});

// POST /api/loans … 借入金の登録（editor 以上）
export const POST = withApi({
  role: "editor",
  schema: LoanSchema,
  handler: async ({ user, db, body }) => {
    const { tenantId } = user;

    let linkedAccountId: number | null = null;
    if (body.linkedAccountCode) {
      const account = await findAccountByCode(db, tenantId, body.linkedAccountCode);
      if (!account) throw badRequest(`unknown linkedAccountCode: ${body.linkedAccountCode}`);
      linkedAccountId = account.id;
    }

    if (body.asset?.mode === "link") {
      const target = await db.personalAsset.findFirst({
        where: { id: body.asset.assetId, tenantId },
      });
      if (!target) throw badRequest(`invalid assetId: ${body.asset.assetId}`);
      if (target.loanId !== null) throw badRequest("この資産には、すでに借入がひも付いています");
    }

    const loan = await db.$transaction(async (tx) => {
      const created = await tx.loan.create({
        data: {
          tenantId,
          lenderName: body.lenderName,
          amount: body.amount,
          interestRate: body.interestRate,
          borrowedOn: new Date(body.borrowedOn),
          repaymentDate: new Date(body.repaymentDate),
          remainingAmount: body.amount,
          note: body.note ?? null,
          loanType: body.loanType ?? "business",
          linkedAccountId,
          monthlyPayment: body.monthlyPayment ?? null,
          residualValue: body.residualValue ?? null,
        },
      });
      // この借入で買った資産: その場で作る（評価額の記録も残す）か、既存の資産にひも付ける
      if (body.asset?.mode === "new") {
        const asset = await tx.personalAsset.create({
          data: {
            tenantId,
            name: body.asset.name,
            category: body.asset.category,
            acquiredOn: body.asset.acquiredOn ? new Date(body.asset.acquiredOn) : null,
            acquisitionCost: body.asset.acquisitionCost ?? null,
            currentValue: body.asset.currentValue,
            loanId: created.id,
          },
        });
        await recordValuation(
          tx,
          tenantId,
          asset.id,
          null,
          body.asset.currentValue,
          ruleOfRow(asset),
        );
      } else if (body.asset?.mode === "link") {
        await tx.personalAsset.update({
          where: { id: body.asset.assetId },
          data: { loanId: created.id },
        });
      }
      return tx.loan.findUniqueOrThrow({ where: { id: created.id }, include: LOAN_INCLUDE });
    });
    await invalidateCache(`assets:summary:${tenantId}:*`);
    return NextResponse.json({ data: loan }, { status: 201 });
  },
});
