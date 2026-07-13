import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

// API 共通の業務エラー。ハンドラ内で throw すると withApi が
// 対応する HTTP レスポンスへ変換する（早期 return の代替）。
//
//   if (!record) throw notFound();
//   if (!account) throw badRequest(`unknown accountCode: ${code}`);
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string) => new ApiError(400, message);
export const notFound = (message = "not found") => new ApiError(404, message);
export const forbidden = (message = "forbidden") => new ApiError(403, message);
export const conflict = (message = "conflict") => new ApiError(409, message);

// ハンドラで発生した例外を HTTP レスポンスへ写像する（withApi の catch 節から呼ばれる）。
// - ApiError: 指定ステータスで返す
// - Prisma の既知エラー: P2002(一意制約)→409 / P2025(対象なし)→404
// - それ以外: 詳細をログに残し、レスポンスには固定メッセージのみ（内部情報の漏えい防止）
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    return NextResponse.json({ error: e.message }, { status: e.status });
  }
  if (e instanceof Prisma.PrismaClientKnownRequestError) {
    if (e.code === "P2002") {
      return NextResponse.json({ error: "conflict: already exists" }, { status: 409 });
    }
    if (e.code === "P2025") {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
  }
  console.error("[api] unhandled error:", e);
  return NextResponse.json({ error: "internal server error" }, { status: 500 });
}
