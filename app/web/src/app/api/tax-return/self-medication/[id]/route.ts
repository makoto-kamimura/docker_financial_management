import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { SelfMedicationSchema } from "@/lib/tax/documents";

// PATCH /api/tax-return/self-medication/[id] … 証憑（レシート）のセルフメディケーション税制の対象の額・品目を直す。
//   amount: null で対象から外す（証憑はそのまま）。現金の明細に付いた自テナントの証憑だけ（editor 以上）
export const PATCH = withApi({
  role: "editor",
  schema: SelfMedicationSchema,
  handler: async ({ user, db, id, body, audit }) => {
    const receipt = await db.receipt.findFirst({
      where: { id, financialRecord: { tenantId: user.tenantId } },
      select: { id: true, selfMedicationAmount: true },
    });
    if (!receipt) throw notFound();
    const updated = await db.receipt.update({
      where: { id },
      data:
        body.amount === null
          ? { selfMedicationAmount: null, selfMedicationItems: [] }
          : { selfMedicationAmount: body.amount, selfMedicationItems: body.items },
      select: { id: true, selfMedicationAmount: true, selfMedicationItems: true },
    });
    await audit("update_self_medication", `receipt:${id}`, {
      before: {
        selfMedicationAmount:
          receipt.selfMedicationAmount === null ? null : Number(receipt.selfMedicationAmount),
      },
      after: { selfMedicationAmount: body.amount },
    });
    return NextResponse.json({
      data: {
        ...updated,
        selfMedicationAmount:
          updated.selfMedicationAmount === null ? null : Number(updated.selfMedicationAmount),
      },
    });
  },
});
