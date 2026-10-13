import { NextResponse } from "next/server";
import { withApi } from "@/lib/server/api-handler";
import { notFound } from "@/lib/server/api-error";
import { readUploadedFile, resolveReceiptFileUrl, storeTenantUpload } from "@/lib/server/upload";

// GET /api/journals/[id]/receipts … 証憑一覧
export const GET = withApi({
  role: "viewer",
  handler: async ({ user, db, id }) => {
    const entry = await db.journalEntry.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!entry) throw notFound();

    const receipts = await db.receipt.findMany({
      where: { journalEntryId: id },
      orderBy: { uploadedAt: "desc" },
    });
    // D-7: fileUrl は savedName からの導出値で応答する（保存済みカラムは信用しない）
    const data = receipts.map((r) => ({ ...r, fileUrl: resolveReceiptFileUrl(r) }));
    return NextResponse.json({ data });
  },
});

// POST /api/journals/[id]/receipts … 証憑アップロード（editor 以上）
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, db, id }) => {
    const entry = await db.journalEntry.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!entry) throw notFound();

    const upload = await readUploadedFile(req);
    const receipt = await db.receipt.create({
      data: { journalEntryId: id, ...(await storeTenantUpload(user.tenantId, upload)) },
    });
    return NextResponse.json(
      { data: { ...receipt, fileUrl: resolveReceiptFileUrl(receipt) } },
      { status: 201 },
    );
  },
});
