import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { removeTenantUpload } from "@/lib/server/upload";

// DELETE /api/tax-return/documents/[id] … 証明書のファイルを消す（editor 以上）
export const DELETE = withApi({
  role: "editor",
  handler: async ({ user, db, id, audit }) => {
    const doc = await db.taxDocument.findFirst({ where: { id } });
    if (!doc) throw notFound();
    await db.taxDocument.delete({ where: { id } });
    await removeTenantUpload(user.tenantId, doc.savedName);
    await audit("delete_tax_document", `tax_document:${id}`, {
      before: { taxYear: doc.taxYear, docId: doc.docId, fileName: doc.fileName },
    });
    return NextResponse.json({ data: { id } });
  },
});
