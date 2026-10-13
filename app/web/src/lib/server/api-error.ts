import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";

// API 共通の業務エラー。ハンドラ内で throw すると withApi が
// 対応する HTTP レスポンスへ変換する（早期 return の代替）。
//
//   if (!record) throw notFound();
//   if (!account) throw badRequest(`unknown accountCode: ${code}`);
//
// code は画面が理由を見分けるための機械向けの値（例: 有料プランが要る "premium_required"）。
// 付けたときだけレスポンスに { error, code } として入る。
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export const badRequest = (message: string) => new ApiError(400, message);
export const notFound = (message = "not found") => new ApiError(404, message);
export const forbidden = (message = "forbidden") => new ApiError(403, message);
export const conflict = (message = "conflict") => new ApiError(409, message);
export const gone = (message = "gone") => new ApiError(410, message);
/** 有料プランが要る（402）。code で何が足りないかを示す */
export const paymentRequired = (message: string, code = "premium_required") =>
  new ApiError(402, message, code);
/** 回数の上限に達した（429） */
export const tooManyRequests = (message: string, code?: string) => new ApiError(429, message, code);
/** 外部サービス（決済など）に接続できない（502） */
export const badGateway = (message: string) => new ApiError(502, message);
/** 機能の設定が済んでいない（503） */
export const serviceUnavailable = (message: string, code?: string) =>
  new ApiError(503, message, code);

/** 実績の直接入力をやめた API が返すメッセージ */
export const DIRECT_ACTUALS_GONE_MESSAGE =
  "実績は明細（現金・銀行・カード）に科目を付けると入ります。科目×月への直接入力はできません";

// ハンドラで発生した例外を HTTP レスポンスへ写像する（withApi の catch 節から呼ばれる）。
// - ApiError: 指定ステータスで返す
// - Prisma の既知エラー: P2002(一意制約)→409 / P2025(対象なし)→404
// - それ以外: 詳細をログに残し、レスポンスには固定メッセージのみ（内部情報の漏えい防止）
export function errorResponse(e: unknown): NextResponse {
  if (e instanceof ApiError) {
    return NextResponse.json(e.code ? { error: e.message, code: e.code } : { error: e.message }, {
      status: e.status,
    });
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
