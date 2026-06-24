import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

type Params = { params: Promise<{ filename: string }> };

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

export async function GET(_req: NextRequest, { params }: Params) {
  const { filename } = await params;
  // パストラバーサル防止
  const safe = path.basename(filename);
  const filePath = path.join(UPLOAD_DIR, safe);

  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const ext = safe.split(".").pop()?.toLowerCase() ?? "";
  const contentTypes: Record<string, string> = {
    pdf: "application/pdf",
    jpg: "image/jpeg", jpeg: "image/jpeg",
    png: "image/png",
    gif: "image/gif",
    webp: "image/webp",
  };
  const contentType = contentTypes[ext] ?? "application/octet-stream";

  const bytes = await readFile(filePath);
  return new NextResponse(bytes, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "private, max-age=3600",
    },
  });
}
