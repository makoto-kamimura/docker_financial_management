import { NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { withApi } from "@/lib/api-handler";
import { badRequest, notFound } from "@/lib/api-error";
import {
  classifyFileType,
  matchesMagicBytes,
  MAX_UPLOAD_BYTES,
  resolveReceiptFileUrl,
  resolveUploadExtension,
  tenantUploadDir,
} from "@/lib/upload";

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

    // リクエストボディがサーバー側の上限を超えて切り詰められた場合、formData() のパースが
    // 例外を投げる（Next.js のデフォルト body size 制限）。500 ではなく 400 として扱う
    let formData: FormData;
    try {
      formData = await req.formData();
    } catch {
      throw badRequest("ファイルサイズは 10MB 以下にしてください");
    }
    const file = formData.get("file") as File | null;
    if (!file) throw badRequest("file is required");
    if (file.size > MAX_UPLOAD_BYTES) throw badRequest("ファイルサイズは 10MB 以下にしてください");

    const ext = resolveUploadExtension(file.name, file.type);
    if (!ext) throw badRequest("許可されていないファイル形式です（pdf/jpg/png/gif/webp のみ）");

    const bytes = await file.arrayBuffer();
    const buf = Buffer.from(bytes);
    // S-8: マジックバイト検証。拡張子・Content-Type の詐称（内容不一致）を検出する
    if (!matchesMagicBytes(buf, ext)) {
      throw badRequest("ファイルの内容が拡張子と一致しません");
    }

    const dir = tenantUploadDir(user.tenantId);
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true });
    }

    const savedName = `${randomUUID()}.${ext}`;
    await writeFile(path.join(dir, savedName), buf);

    const receipt = await db.receipt.create({
      data: {
        journalEntryId: id,
        fileName: file.name,
        // D-7: fileUrl 列は 1 リリース据え置き後に削除予定のため書き込みは維持するが、
        // レスポンスは resolveReceiptFileUrl() の導出値を返す（下記）
        fileUrl: `/api/uploads/${savedName}`,
        savedName,
        mimeType: file.type,
        fileType: classifyFileType(file.type),
        fileSize: file.size,
      },
    });
    return NextResponse.json(
      { data: { ...receipt, fileUrl: resolveReceiptFileUrl(receipt) } },
      { status: 201 },
    );
  },
});
