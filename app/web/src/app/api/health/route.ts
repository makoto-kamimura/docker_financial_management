import { NextResponse } from "next/server";

// ヘルスチェック用エンドポイント: GET /api/health
export async function GET() {
  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString() });
}
