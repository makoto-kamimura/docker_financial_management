import { NextResponse } from "next/server";
import { z } from "zod";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { postIssueRecord } from "@/lib/settlement";

const UpdateSchema = z.object({
  status: z.string().optional(),
  note: z.string().optional(),
});

// GET /api/invoices/[id] … インボイス 1 件の取得
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const invoice = await db.invoice.findUnique({
      where: { id, tenantId: user.tenantId },
      include: { lines: true, receivable: true },
    });
    if (!invoice) throw notFound();
    return NextResponse.json({ data: invoice });
  },
});

// PUT /api/invoices/[id] … インボイスのステータス・備考更新（editor 以上）
// D-3: status を "issued" にすると、対応する売掛金（Receivable）を自動生成し FK でリンクする。
// リンク済みインボイスは、入金消込（POST /api/receivables/[id]/pay）を単一の真実として "paid" へ
// 遷移させるため、本エンドポイントからの直接の "paid" 指定は拒否する。
export const PUT = withApi({
  role: "editor",
  schema: UpdateSchema,
  handler: async ({ user, db, id, body }) => {
    const { tenantId } = user;
    const existing = await db.invoice.findUnique({
      where: { id, tenantId },
      include: { receivable: true },
    });
    if (!existing) throw notFound();

    if (body.status === "paid" && existing.receivable && existing.receivable.status !== "paid") {
      throw badRequest(
        "この請求書は売掛金にリンクされています。入金消込（売掛金管理）から入金登録してください。",
      );
    }

    const invoice = await db.$transaction(async (tx) => {
      const updated = await tx.invoice.update({
        where: { id },
        data: {
          ...(body.status && { status: body.status }),
          ...(body.note !== undefined && { note: body.note }),
        },
        include: { lines: true, receivable: true },
      });

      if (body.status === "issued" && !existing.receivable) {
        const receivable = await tx.receivable.create({
          data: {
            tenantId,
            customerName: updated.customerName,
            description: `請求書 ${updated.invoiceNumber}`,
            amount: updated.total,
            taxAmount: updated.taxAmount,
            issueDate: updated.issueDate,
            dueDate: updated.dueDate,
            invoiceNumber: updated.invoiceNumber,
            invoiceId: updated.id,
          },
        });
        await postIssueRecord(tx, tenantId, "receivable", updated.issueDate, Number(updated.total));
        return { ...updated, receivable };
      }

      return updated;
    });
    return NextResponse.json({ data: invoice });
  },
});

// DELETE /api/invoices/[id] … インボイスの削除（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id }) => {
    const existing = await db.invoice.findUnique({
      where: { id, tenantId: user.tenantId },
      include: { receivable: true },
    });
    if (!existing) throw notFound();
    if (existing.receivable) {
      throw badRequest(
        "売掛金にリンクされた請求書は削除できません。先に売掛金を削除してください。",
      );
    }

    await db.invoice.delete({ where: { id } });
    return NextResponse.json({ ok: true });
  },
});
