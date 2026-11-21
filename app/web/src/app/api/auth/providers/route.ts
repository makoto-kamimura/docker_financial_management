import { NextResponse } from "next/server";
import { providers } from "@/lib/server/sso";

// GET /api/auth/providers … ログイン画面が「SSO でログイン」を出すかどうかと、その名前（公開）
export async function GET() {
  return NextResponse.json(providers());
}
