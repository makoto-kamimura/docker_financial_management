import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { prisma } from "@/lib/prisma";
import { requireRole } from "@/lib/authz";

type Params = { params: Promise<{ id: string }> };

const UPLOAD_DIR = path.join(process.cwd(), "uploads");

// GET /api/journals/[id]/receipts
export async function GET(_req: NextRequest, { params }: Params) {
  const auth = await requireRole("viewer");
  if (auth.error) return auth.error;

  const { id } = await params;
  const receipts = await prisma.receipt.findMany({
    where: { journalEntryId: Number(id) },
    orderBy: { uploadedAt: "desc" },
  });
  return NextResponse.json({ data: receipts });
}

// POST /api/journals/[id]/receipts — multipart upload
export async function POST(req: NextRequest, { params }: Params) {
  const auth = await requireRole("editor");
  if (auth.error) return auth.error;

  const { id } = await params;
  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) return NextResponse.json({ error: "file is required" }, { status: 400 });

  if (!existsSync(UPLOAD_DIR)) {
    await mkdir(UPLOAD_DIR, { recursive: true });
  }

  const ext = file.name.split(".").pop() ?? "";
  const savedName = `${randomUUID()}.${ext}`;
  const bytes = await file.arrayBuffer();
  await writeFile(path.join(UPLOAD_DIR, savedName), Buffer.from(bytes));

  const fileType = file.type.startsWith("image/")
    ? "image"
    : file.type === "application/pdf"
      ? "pdf"
      : "other";

  const receipt = await prisma.receipt.create({
    data: {
      journalEntryId: Number(id),
      fileName: file.name,
      fileUrl: `/api/uploads/${savedName}`,
      fileType,
      fileSize: file.size,
    },
  });
  return NextResponse.json({ data: receipt }, { status: 201 });
}
