import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import { classifyFileType, resolveUploadExtension } from "@/lib/upload";

const UPLOAD_DIR = path.join(process.cwd(), "uploads");
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10MB

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
    return NextResponse.json({ data: receipts });
  },
});

// POST /api/journals/[id]/receipts … 証憑アップロード（editor 以上）
export const POST = withApi({
  role: "editor",
  handler: async ({ req, user, db, id }) => {
    const entry = await db.journalEntry.findUnique({ where: { id, tenantId: user.tenantId } });
    if (!entry) throw notFound();

    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    if (!file) throw badRequest("file is required");
    if (file.size > MAX_UPLOAD_BYTES) throw badRequest("ファイルサイズは 10MB 以下にしてください");

    const ext = resolveUploadExtension(file.name, file.type);
    if (!ext) throw badRequest("許可されていないファイル形式です（pdf/jpg/png/gif/webp のみ）");

    if (!existsSync(UPLOAD_DIR)) {
      await mkdir(UPLOAD_DIR, { recursive: true });
    }

    const savedName = `${randomUUID()}.${ext}`;
    const bytes = await file.arrayBuffer();
    await writeFile(path.join(UPLOAD_DIR, savedName), Buffer.from(bytes));

    const receipt = await db.receipt.create({
      data: {
        journalEntryId: id,
        fileName: file.name,
        fileUrl: `/api/uploads/${savedName}`,
        savedName,
        mimeType: file.type,
        fileType: classifyFileType(file.type),
        fileSize: file.size,
      },
    });
    return NextResponse.json({ data: receipt }, { status: 201 });
  },
});
